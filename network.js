/* ============================================================================
 * network.js — Multijoueur P2P sans serveur (Trystero)
 * ----------------------------------------------------------------------------
 * Deux salons Trystero coexistent :
 *   • le salon GLOBAL  (cac-lobby-v1) : annonces des parties, roster, démarrage
 *   • le salon de JEU  (cac-game-<code>) : trafic temps réel de la partie
 *
 * Modèle de synchronisation : chaque client est autoritaire sur SES unités et
 * diffuse leur transformée 10 fois par seconde. Les clients distants
 * interpolent. Aucun serveur, aucun état partagé à arbitrer.
 * ========================================================================== */

const APP_ID = 'command-and-collapse-v1';
const LOBBY_ROOM = 'cac-lobby-v1';
const TRYSTERO_VERSION = '0.21.5';

export const MAX_PLAYERS = 4;
const ANNOUNCE_MS = 2000;   // cadence d'annonce imposée par le cahier des charges
const ROOM_TTL_MS = 6000;   // une annonce non rafraîchie disparaît
const JOIN_TIMEOUT_MS = 5000;

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export class Network {
  constructor() {
    this.selfId = null;
    this.strategy = 'mqtt';
    this.lobby = null;
    this.game = null;
    this.act = {};
    this.gact = {};
    this.handlers = new Map();
    this.rooms = new Map();
    this.myRoom = null;
    this.pending = null;
    this.started = false;
    this.inGame = false;
    this.profile = { name: 'Joueur', faction: 'atlantic', color: '#3b82f6' };
    this._timers = [];
  }

  /* ------------------------------------------------------------- événements */

  on(event, fn) {
    if (!this.handlers.has(event)) this.handlers.set(event, []);
    this.handlers.get(event).push(fn);
    return this;
  }

  emit(event, ...args) {
    const list = this.handlers.get(event);
    if (!list) return;
    for (const fn of list) {
      try { fn(...args); } catch (err) { console.error(`[net] handler "${event}"`, err); }
    }
  }

  /* ------------------------------------------------------------ initialisation */

  async init() {
    const params = new URLSearchParams(location.search);
    this.strategy = params.get('net') === 'torrent' ? 'torrent' : 'mqtt';

    // Import dynamique : la stratégie de signalisation est choisie à l'exécution.
    const mod = await import(
      `https://cdn.jsdelivr.net/npm/trystero@${TRYSTERO_VERSION}/${this.strategy}/+esm`
    );

    this.selfId = mod.selfId;
    this._join = mod.joinRoom;

    this.lobby = this._join({ appId: APP_ID }, LOBBY_ROOM);
    this._bindLobby();
    this._startTimers();

    this.emit('ready', { selfId: this.selfId, strategy: this.strategy });
    return this;
  }

  /* --------------------------------------------------------------- protocole */

  _bindLobby() {
    const mk = (name) => {
      const [send, recv] = this.lobby.makeAction(name);
      return { send, recv };
    };

    this.act = {
      ann:    mk('ann'),
      hello:  mk('hello'),
      join:   mk('join'),
      roster: mk('roster'),
      start:  mk('start'),
      close:  mk('close'),
      leave:  mk('leave')
    };

    // Annonce d'un salon (reçue par tout le monde sauf l'hôte concerné)
    this.act.ann.recv((data) => {
      if (!data || !data.code) return;
      if (this.myRoom && data.code === this.myRoom.code) return;
      this.rooms.set(data.code, { ...data, seen: Date.now() });
      this.emit('rooms', this._roomList());
    });

    // Un nouveau venu demande l'état du réseau : les hôtes se re-annoncent
    this.act.hello.recv(() => {
      if (this.myRoom && this.myRoom.isHost && !this.started) this._announce();
    });

    // Demande d'entrée dans un salon (traitée par l'hôte)
    this.act.join.recv((data, peerId) => {
      if (!this.myRoom || !this.myRoom.isHost || this.started) return;
      if (!data || data.code !== this.myRoom.code) return;

      if (this.myRoom.players.length >= MAX_PLAYERS) {
        this.act.roster.send({ code: data.code, error: 'full' }, peerId);
        return;
      }

      if (!this.myRoom.players.some((p) => p.id === peerId)) {
        const p = data.player || {};
        this.myRoom.players.push({
          id: peerId,
          name: String(p.name || 'Joueur').slice(0, 16),
          faction: String(p.faction || 'atlantic'),
          color: String(p.color || '#3b82f6')
        });
      }

      this._broadcastRoster();
      this._announce();
    });

    // Roster (soit une réponse à ma demande, soit une mise à jour de l'hôte)
    this.act.roster.recv((data) => {
      if (!data) return;

      if (data.error === 'full') {
        this.pending = null;
        this.emit('joinFailed', 'Ce salon est complet (4 joueurs maximum).');
        return;
      }

      if (this.pending && data.code === this.pending) {
        this.pending = null;
        this.myRoom = {
          code: data.code,
          host: data.host,
          players: data.players || [],
          isHost: data.host === this.selfId,
          isPrivate: !!data.isPrivate
        };
        this.emit('roster', this.myRoom);
        return;
      }

      if (this.myRoom && data.code === this.myRoom.code) {
        this.myRoom.players = data.players || [];
        this.myRoom.host = data.host;
        this.emit('roster', this.myRoom);
      }
    });

    // Lancement de la partie décidé par l'hôte
    this.act.start.recv((data) => {
      if (!data || !this.myRoom || data.code !== this.myRoom.code) return;
      this.started = true;
      this.emit('start', data);
    });

    // Fermeture du salon par l'hôte
    this.act.close.recv((data) => {
      if (!data || !this.myRoom || data.code !== this.myRoom.code) return;
      this.myRoom = null;
      this.started = false;
      this.emit('closed', data.reason || "L'hôte a fermé le salon.");
    });

    // Départ volontaire d'un joueur
    this.act.leave.recv((data, peerId) => {
      if (!this.myRoom || !this.myRoom.isHost) return;
      if (!data || data.code !== this.myRoom.code) return;
      const before = this.myRoom.players.length;
      this.myRoom.players = this.myRoom.players.filter((p) => p.id !== peerId);
      if (this.myRoom.players.length !== before) this._broadcastRoster();
    });

    this.lobby.onPeerJoin((peerId) => {
      this.act.hello.send({}, peerId);
      if (this.myRoom && this.myRoom.isHost && !this.started) this._announce();
      this.emit('peers', this.peerCount());
    });

    this.lobby.onPeerLeave((peerId) => {
      if (this.myRoom && this.myRoom.isHost) {
        const before = this.myRoom.players.length;
        this.myRoom.players = this.myRoom.players.filter((p) => p.id !== peerId);
        if (this.myRoom.players.length !== before) this._broadcastRoster();
      }
      this.emit('peers', this.peerCount());
    });
  }

  _startTimers() {
    // Annonce périodique des salons ouverts
    this._timers.push(setInterval(() => this._announce(), ANNOUNCE_MS));

    // Purge des annonces périmées
    this._timers.push(setInterval(() => {
      const now = Date.now();
      let changed = false;
      for (const [code, room] of this.rooms) {
        if (now - room.seen > ROOM_TTL_MS) {
          this.rooms.delete(code);
          changed = true;
        }
      }
      if (changed) this.emit('rooms', this._roomList());
    }, 1000));

    // Demande initiale de l'état du réseau (le pair-à-pair met ~1 s à s'établir)
    this.act.hello.send({});
    this._timers.push(setTimeout(() => this.act.hello.send({}), 1200));
    this._timers.push(setTimeout(() => this.act.hello.send({}), 3000));
  }

  /* ------------------------------------------------------------------ salons */

  _roomList() {
    return [...this.rooms.values()]
      .filter((r) => !this.myRoom || r.code !== this.myRoom.code)
      .sort((a, b) => b.seen - a.seen);
  }

  _announce() {
    if (!this.myRoom || !this.myRoom.isHost || this.started) return;
    this.act.ann.send({
      code: this.myRoom.code,
      host: this.selfId,
      hostName: this.myRoom.players[0] ? this.myRoom.players[0].name : 'Hôte',
      players: this.myRoom.players,
      max: MAX_PLAYERS,
      isPrivate: this.myRoom.isPrivate,
      started: this.started
    });
  }

  _broadcastRoster() {
    if (!this.myRoom) return;
    const targets = this.myRoom.players.map((p) => p.id).filter((id) => id !== this.selfId);
    const payload = {
      code: this.myRoom.code,
      host: this.myRoom.host,
      players: this.myRoom.players,
      isPrivate: this.myRoom.isPrivate
    };
    if (targets.length) this.act.roster.send(payload, targets);
    this.emit('roster', this.myRoom);
  }

  _code() {
    let out = '';
    for (let i = 0; i < 5; i++) {
      out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    }
    return out;
  }

  /** Crée un salon (public = annoncé, privé = rejoignable par code seulement). */
  createRoom(profile, isPrivate = false) {
    this.profile = { ...this.profile, ...profile };
    this.myRoom = {
      code: this._code(),
      host: this.selfId,
      players: [{
        id: this.selfId,
        name: String(this.profile.name || 'Hôte').slice(0, 16),
        faction: this.profile.faction,
        color: this.profile.color
      }],
      isHost: true,
      isPrivate: !!isPrivate
    };
    this.started = false;
    this._announce();
    this.emit('roster', this.myRoom);
    return this.myRoom;
  }

  /** Demande à rejoindre un salon par son code. */
  joinRoom(code) {
    code = String(code || '').trim().toUpperCase();
    if (!code) return;
    this.pending = code;
    this.act.join.send({ code, player: this.profile });

    clearTimeout(this._joinTimer);
    this._joinTimer = setTimeout(() => {
      if (this.pending === code) {
        this.pending = null;
        this.emit('joinFailed', `Aucun salon « ${code} » ne répond.`);
      }
    }, JOIN_TIMEOUT_MS);
  }

  /** Quitte le salon courant (fermeture si on est hôte). */
  leaveRoom() {
    if (!this.myRoom) return;
    if (this.myRoom.isHost) {
      this.act.close.send({ code: this.myRoom.code, reason: "L'hôte a fermé le salon." });
    } else {
      this.act.leave.send({ code: this.myRoom.code });
    }
    this.myRoom = null;
    this.started = false;
  }

  /**
   * L'hôte lance la partie : tout le monde bascule sur l'arène.
   * @param {object} settings paramètres de difficulté (argent, brouillard, IA…)
   */
  startGame(settings = {}) {
    if (!this.myRoom || !this.myRoom.isHost) return;
    const data = {
      code: this.myRoom.code,
      players: this.myRoom.players,
      seed: Math.floor(Math.random() * 1e9),
      settings
    };
    this.started = true;
    this.act.start.send(data);
    this.emit('start', data);
  }

  /* -------------------------------------------------------------- salon de jeu */

  enterGame(code) {
    if (this.game) return;
    this.game = this._join({ appId: APP_ID }, `cac-game-${code}`);

    const mk = (name) => {
      const [send, recv] = this.game.makeAction(name);
      return { send, recv };
    };
    this.gact = {
      ents: mk('ents'),      // instantané des entités possédées
      order: mk('order'),    // marqueur d'ordre de déplacement
      hit: mk('hit'),        // dégâts infligés à une entité distante
      harvest: mk('harvest') // ponction sur un champ de cristaux
    };

    this.gact.ents.recv((data) => {
      if (data && Array.isArray(data.e)) this.emit('ents', data);
    });
    this.gact.order.recv((data) => {
      if (data && typeof data.x === 'number') this.emit('order', data);
    });
    this.gact.hit.recv((data) => {
      if (data && data.target) this.emit('hit', data);
    });
    this.gact.harvest.recv((data) => {
      if (data && data.field) this.emit('harvest', data);
    });

    this.game.onPeerJoin(() => this.emit('gamePeers', this.gamePeerCount()));
    this.game.onPeerLeave(() => this.emit('gamePeers', this.gamePeerCount()));

    this.inGame = true;
    this.emit('gamePeers', this.gamePeerCount());
  }

  leaveGame() {
    this.inGame = false;
    if (this.game) {
      try { this.game.leave(); } catch (err) { console.warn('[net] leave game', err); }
      this.game = null;
      this.gact = {};
    }
  }

  sendEnts(payload) {
    if (this.gact.ents) this.gact.ents.send(payload);
  }

  sendOrder(payload) {
    if (this.gact.order) this.gact.order.send(payload);
  }

  sendHit(payload) {
    if (this.gact.hit) this.gact.hit.send(payload);
  }

  sendHarvest(payload) {
    if (this.gact.harvest) this.gact.harvest.send(payload);
  }

  /* ------------------------------------------------------------------ compteurs */

  peerCount() {
    return this.lobby ? Object.keys(this.lobby.getPeers() || {}).length : 0;
  }

  gamePeerCount() {
    return this.game ? Object.keys(this.game.getPeers() || {}).length : 0;
  }
}
