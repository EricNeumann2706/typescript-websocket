import { EAction } from '../base/enumerators';
import { ClientSocket } from './clientSocket';
import { Message } from './message';
import { LoggerHelper } from '../helpers/logger-helper';

export interface LobbyParticipant {
    username: string
    leader: string
    team: number
}

export interface LobbySettings {
    mapSize: number
    mapType: number
    barbarianCount: number
    timer: number
    mapName: string
}

export class LobbyBot implements LobbyParticipant {
    constructor(
        public username: string,
        public leader: string,
        public team: number,
        public strength: number
    ) {}
}

export class Lobby {
    id: string = ''
    players: ClientSocket[] = []
    playerIdsBanned: string[] = []

    settings: LobbySettings | undefined
    bots: LobbyBot[] = []

    isGameStarted = false
    isPublic = true
    joinCode: string = ''

    constructor(id: string, isPublic: boolean = true, players: ClientSocket[] = []) {
        try {
            this.players = players
            this.id = id
            this.isPublic = isPublic
            if(this.joinCode == '') this.generateJoinCode()

            this.settings = {
                mapSize: 15,
                mapType: 0,
                barbarianCount: 1,
                timer: 0,
                mapName: ''
            }

        } catch (err) {
            LoggerHelper.logError(`Lobby create error: ${err}`);
        }
    }

    setPrivacy(isPublic: boolean) {
        this.isPublic = isPublic;
        if (!isPublic && this.joinCode == '') this.generateJoinCode();
        else this.joinCode = '';
    }

    generateJoinCode(length: number = 6) {
        const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        let code = "";
        for (let i = 0; i < length; i++) {
            code += chars[Math.floor(Math.random() * chars.length)];
        }
        this.joinCode = code;
    }

    addPlayer(newPlayer: ClientSocket) {
        if (this.playerIdsBanned.includes(newPlayer.id)) return false
        if (this.players.find(p => p.id === newPlayer.id)) return false

        newPlayer.lobbyId = this.id
        this.players.push(newPlayer)

        this.broadcastLobbyChanged(newPlayer.username + ' joined the lobby.')

        return true
    }

    removePlayer(idPlayer: string) {
        const player = this.players.find(p => p.id === idPlayer)
        if (!player) return

        player.lobbyId = ''
        this.players = this.players.filter(p => p.id !== idPlayer)

        this.broadcastLobbyChanged(player.username + ' left.')
    }

    addBot(bot: LobbyBot) {
        this.bots.push(bot)
    }

    removeBot(username: string) {
        this.bots = this.bots.filter(b => b.username !== username)
    }

    updateBot(username: string, data: Partial<LobbyBot>) {
        const bot = this.bots.find(b => b.username === username)
        if (!bot) return

        if (data.leader !== undefined) bot.leader = data.leader
        if (data.strength !== undefined) bot.strength = data.strength
        if (data.team !== undefined) bot.team = data.team
    }

    private broadcastLobbyChanged(messageText: string) {
        const messageChanged = new Message(EAction.LobbyChanged, {
            lobby: this.get(),
        });

        const messageLobbyEvent = new Message(EAction.LobbyEvent, {
            message: messageText,
        });

        this.players.forEach(p => {
            p.socket.send(messageChanged.toString());
            p.socket.send(messageLobbyEvent.toString());
        });
    }

    get = () => ({
        id: this.id,
        isGameStarted: this.isGameStarted,
        players: this.players,
        bots: this.bots,
        settings: this.settings,
        isPublic: this.isPublic,
        joinCode: this.joinCode
    })
}
