import { EAction } from '../base/enumerators'
import { ClientSocket } from './clientSocket'
import { Message } from './message'
import { LoggerHelper } from '../helpers/logger-helper'

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
    playerIdsBanned: string[] = []

    settings: LobbySettings | undefined

    isGameStarted = false
    isPublic = true
    joinCode: string = ''

    maxSlots = 8
    private slots: (ClientSocket | LobbyBot | null)[] = []

    get players(): ClientSocket[] {
        return this.slots.filter(s => s instanceof ClientSocket) as ClientSocket[]
    }

    get bots(): LobbyBot[] {
        return this.slots.filter(s => s instanceof LobbyBot) as LobbyBot[]
    }

    constructor(id: string, isPublic: boolean = true, players: ClientSocket[] = []) {
        try {
            this.id = id
            this.isPublic = isPublic

            if (this.joinCode === '')
                this.generateJoinCode()

            for (let i = 0; i < this.maxSlots; i++)
                this.slots.push(null)

            this.settings = {
                mapSize: 1,
                mapType: 0,
                barbarianCount: 0,
                timer: 0,
                mapName: ''
            }

            players.forEach(p => this.addPlayer(p))

        } catch (err) {
            LoggerHelper.logError(`Lobby create error: ${err}`)
        }
    }

    // =====================================================
    // SLOTS
    // =====================================================

    private compactSlots() {

        const filled = this.slots.filter(s => s !== null)

        while (filled.length < this.maxSlots)
            filled.push(null)

        this.slots = filled
    }

    // =====================================================
    // PRIVACY
    // =====================================================

    setPrivacy(isPublic: boolean) {
        this.isPublic = isPublic
        if (!isPublic && this.joinCode === '')
            this.generateJoinCode()
    }

    generateJoinCode(length: number = 6) {
        const chars = "abcdefghiklmnpqrstuvwxyz23456789"
        let code = ""

        for (let i = 0; i < length; i++)
            code += chars[Math.floor(Math.random() * chars.length)]

        this.joinCode = code
    }

    // =====================================================
    // PLAYER LOGIC
    // =====================================================

    addPlayer(newPlayer: ClientSocket) {

        if (this.playerIdsBanned.includes(newPlayer.id))
            return false

        if (this.players.find(p => p.id === newPlayer.id))
            return false

        const index = this.slots.findIndex(s => s === null)
        if (index === -1)
            return false

        newPlayer.lobbyId = this.id
        newPlayer.host = this.players.length === 0

        this.slots[index] = newPlayer

        this.broadcastLobbyChanged(newPlayer.username + ' joined the lobby.')

        return true
    }

    removePlayer(idPlayer: string) {

        const index = this.slots.findIndex(s =>
            s instanceof ClientSocket && s.id === idPlayer
        )

        if (index === -1)
            return

        const player = this.slots[index] as ClientSocket
        const wasHost = player.host

        player.lobbyId = ''
        player.host = false

        this.slots[index] = null

        this.compactSlots()

        if (wasHost && this.players.length > 0)
            this.players[0].host = true

        this.broadcastLobbyChanged(player.username + ' left.')
    }

    // =====================================================
    // BOT LOGIC
    // =====================================================

    addBot(bot: LobbyBot) {
        const index = this.slots.findIndex(s => s === null)
        if (index === -1) return false

        this.slots[index] = bot
        return true
    }

    removeBot(username: string) {
        const index = this.slots.findIndex(s =>
            s instanceof LobbyBot && s.username === username
        )

        if (index !== -1)
        {
            this.slots[index] = null
            this.compactSlots()
        }
            
    }

    updateBot(username: string, data: Partial<LobbyBot>) {

        const bot = this.slots.find(s =>
            s instanceof LobbyBot && s.username === username
        ) as LobbyBot

        if (!bot) return

        Object.assign(bot, data)
    }

    // =====================================================
    // NETWORK
    // =====================================================

    private broadcastLobbyChanged(messageText: string) {

        const messageChanged = new Message(EAction.LobbyChanged, {
            lobby: this.get(),
        })

        const messageLobbyEvent = new Message(EAction.LobbyEvent, {
            message: messageText,
        })

        this.players.forEach(p => {
            p.socket.send(messageChanged.toString())
            p.socket.send(messageLobbyEvent.toString())
        })
    }

    // =====================================================
    // SERIALIZATION
    // =====================================================

    get = () => ({
        id: this.id,
        isGameStarted: this.isGameStarted,
        players: this.players.map(p => ({
            id: p.id,
            username: p.username,
            leader: p.leader,
            team: p.team,
            host: p.host
        })),
        bots: this.bots,
        settings: this.settings,
        isPublic: this.isPublic,
        joinCode: this.joinCode,
        isFull: !this.slots.includes(null),
        slots: this.slots.map(s => {
            if (!s)
                return { type: 'empty' }

            if (s instanceof ClientSocket)
                return {
                    type: 'player',
                    id: s.id,
                    username: s.username,
                    leader: s.leader,
                    team: s.team,
                    host: s.host
                }

            if (s instanceof LobbyBot)
                return {
                    type: 'bot',
                    username: s.username,
                    leader: s.leader,
                    team: s.team,
                    strength: s.strength
                }
        })                      //eigentlich sollte man nur slots oder player+bots verschicken aber so funktioniert es echt gut
    })
}