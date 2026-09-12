export type AccountView = {
  readonly id: string
  readonly username: string
  readonly displayName: string
  readonly createdAt: string
}

export type AuthSessionView = {
  readonly user: AccountView
}

export type LeagueRole = 'owner' | 'admin' | 'player'

export type LeagueMemberView = {
  readonly user: AccountView
  readonly role: LeagueRole
  readonly joinedAt: string
  readonly teamStatus: 'not-started' | 'drafting' | 'submitted'
}

export type TournamentStatus = 'planning' | 'registration-open' | 'teams-locked' | 'in-progress' | 'completed'

export type TournamentRulesView = {
  readonly gameProfileId: 'firered-gen3-v1'
  readonly battleFormat: 'singles'
  readonly bracket: 'single-elimination'
  readonly bestOf: 1 | 3 | 5
  readonly teamSize: number
  readonly levelPolicy: 'actual-levels'
  readonly teamPreview: false
  readonly duplicateSpecies: boolean
  readonly duplicateHeldItems: boolean
  readonly usableBagItems: false
}

export type TournamentView = {
  readonly id: string
  readonly leagueId: string
  readonly name: string
  readonly status: TournamentStatus
  readonly startsAt: string | null
  readonly teamLockAt: string | null
  readonly rules: TournamentRulesView
  readonly createdAt: string
}

export type LockedTeamView = {
  readonly registrationId: string
  readonly tournamentId: string
  readonly lockedAt: string
  readonly pokemonCount: number
  readonly status: 'locked'
}

export type TournamentMatchView = {
  readonly battleId: string
  readonly seriesId: string
  readonly tournamentId: string
  readonly status: 'active' | 'completed'
  readonly gameNumber: number
  readonly bestOf: 1 | 3 | 5
  readonly playerWins: number
  readonly opponentWins: number
  readonly opponent: AccountView
  readonly winner: AccountView | null
}

export type LeagueSummaryView = {
  readonly id: string
  readonly name: string
  readonly role: LeagueRole
  readonly memberCount: number
  readonly nextTournament: TournamentView | null
  readonly createdAt: string
}

export type LeagueDetailView = {
  readonly id: string
  readonly name: string
  readonly currentUserRole: LeagueRole
  readonly members: readonly LeagueMemberView[]
  readonly tournaments: readonly TournamentView[]
  readonly createdAt: string
}

export type LeagueInvitationView = {
  readonly id: string
  readonly leagueId: string
  readonly leagueName: string
  readonly invitedUser: AccountView
  readonly invitedBy: AccountView
  readonly status: 'pending' | 'accepted' | 'declined' | 'cancelled'
  readonly createdAt: string
}
