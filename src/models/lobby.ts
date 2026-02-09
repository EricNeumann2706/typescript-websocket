import { EAction } from '../base/enumerators';
import { ClientSocket } from './clientSocket';
// import { LobbyClient } from './lobbyClient'; //NOTE: REmoved. I think oit was for security, so that a LobbyClient shared less data than a ClientSocket
// Lobbyclient mapped on players for the get, but dropped "color"
import { Message } from './message';
import { LoggerHelper } from '../helpers/logger-helper';

export class Lobby {
	id: String = '';
	players: ClientSocket[] = [];
	playerIdsBanned: string[] = [];
	lobbyData: any = {};
	isGameStarted: boolean = false;
	isPublic: boolean = true;

	constructor(id: String, isPublic: boolean = true, players: ClientSocket[] = []) {
		try {
			this.players = players;
			this.id = id;
			this.lobbyData = {};
			this.isPublic = isPublic;
		} catch (err) {
			LoggerHelper.logError(`An error had occurred while creating the Lobby: ${err}`);
		}
	}

	addPlayer(newPlayer: ClientSocket) {
		try {
			// Do not let a kicked player rejoin
			if (this.playerIdsBanned.find((bannedId) => bannedId === newPlayer.id)) {
				return false;
			}
			// Stop if the player is already in the lobby
			if (this.players.find((el) => el.id === newPlayer.id)) {
				return false;
			}
			newPlayer.lobbyId = this.id;
			// Add the player to the Lobby list
			this.players.push(newPlayer);

			// And tell all players to get their own lobby.
			const messageChanged = new Message(EAction.LobbyChanged, {
				lobby: this.get(),
			});
			const messageLobbyEvent = new Message(EAction.LobbyEvent, {
				message: newPlayer.username + ' just joined the lobby.',
			});
			this.players.forEach((el) => {
				el.socket.send(messageChanged.toString());
				el.socket.send(messageLobbyEvent.toString());
			});

			return true;
		} catch (err) {
			LoggerHelper.logError(`An error had occurred while adding a new player to the Lobby: ${err}`);
		}
	}

	removePlayer(idPlayer: String) {
		try {
			let playerToRemove = this.players.find((currentClientSocket) => currentClientSocket.id == idPlayer);
			if (playerToRemove) {
				playerToRemove.lobbyId = '';

				// Tell this player that they should get the lobby: TODO: Should it be for everyone?
				const message = new Message(EAction.LobbyChanged, {});
				playerToRemove.socket.send(message.toString());
				// remove the player from the list
				const index = this.players.findIndex((el) => el.id === idPlayer);
				if (index !== -1) {
					this.players.splice(index, 1);
				}

				// TODO: THis sends the "playerLeft" which is for disconnects.... make a specific to leaving lobby event and remove messageLobbyEvent
				// const playerLeftMessage = new Message(EAction.PlayerLeft, {});
				// this.players.forEach((el) => el.socket.send(playerLeftMessage.toString()));

				// And tell all players to get their own lobby.
				const messageChanged = new Message(EAction.LobbyChanged, {
					lobby: this.get(),
				});
				const messageLobbyEvent = new Message(EAction.LobbyEvent, {
					message: playerToRemove?.username + ' left.',
				});
				this.players.forEach((el) => {
					el.socket.send(messageChanged.toString());
					el.socket.send(messageLobbyEvent.toString());
				});
			}
		} catch (err) {
			LoggerHelper.logError(`An error had occurred while removing a player from the Lobby: ${err}`);
		}
	}

	get = () => {
		try {
			return {
				id: this.id,
				isGameStarted: this.isGameStarted,
				players: this.players,
				lobbyData: this.lobbyData,
				isPublic: this.isPublic,
			};
		} catch (err) {
			LoggerHelper.logError(`An error had occurred while getting the lobby: ${err}`);
		}
	};
}
