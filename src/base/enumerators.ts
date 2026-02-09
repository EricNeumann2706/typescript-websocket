// TODO: Protobuf. Redoo all this and achieve end-to-end type saftey... somehow.

// Note: the 0 indexed enums that the godot client expects are in the comments... not great, but.
// New entries should be incremented to evolve the api, no removing... unless you're careful.
export enum EAction {
	Confirm = 'Confirm', // 0
	GetUsers = 'GetUsers', // 1
	PlayerJoin = 'PlayerJoin', // 2
	PlayerLeft = 'PlayerLeft', // 3
	GetLobbies = 'GetLobbies', // 4
	GetOwnLobby = 'GetOwnLobby', // 5
	CreateLobby = 'CreateLobby', // 6
	JoinLobby = 'JoinLobby', // 7
	LeaveLobby = 'LeaveLobby', // 8
	LobbyChanged = 'LobbyChanged', // 9
	GameStarted = 'GameStarted', // 10
	MessageToLobby = 'MessageToLobby', // 11
	PlayerInfoUpdate = 'PlayerInfoUpdate', // 12
	// Web RTC
	NewPeerConnection = 'NewPeerConnection', // 13
	Offer = 'Offer', // 14
	Answer = 'Answer', // 15
	Candidate = 'Candidate', // 16
	KickPlayer = 'KickPlayer', // 17
	LobbyEvent = 'LobbyEvent',
	SetIceServers = 'SetIceServers',
}
