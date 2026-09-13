import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import type {
  AccountView,
  LeagueDetailView,
  LeagueInvitationView,
  LeagueSummaryView,
  TournamentMatchView,
  TournamentView,
  TrainerCardView,
  TrainerSpriteId,
} from "@pmb/domain";
import { trainerSpriteIds } from "@pmb/domain";
import { TournamentTeamBuilder } from "./PokemonBox";
import { GameIcon } from "./GameIcon";
import { productApi as api, useSession } from "./productApi";
import styles from "./ProductFlow.module.scss";

export function AuthPage() {
  const session = useSession();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"register" | "login">("register");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  if (session.data) return <Navigate to="/app" replace />;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      await api(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(Object.fromEntries(form)),
      });
      await queryClient.invalidateQueries({ queryKey: ["session"] });
      navigate("/app");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not continue.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <main className={styles.authPage}>
      <section className={styles.authConsole}>
        <div className={styles.authBrand}>
          <span aria-hidden="true">PM</span>
          <div><strong>Pocket Monster Brawl</strong></div>
        </div>
        <form className={styles.card} onSubmit={submit}>
          <div className={styles.tabs}>
          <button
            aria-pressed={mode === "register"}
            onClick={() => setMode("register")}
            type="button"
          >
            Create account
          </button>
          <button
            aria-pressed={mode === "login"}
            onClick={() => setMode("login")}
            type="button"
          >
            Sign in
          </button>
          </div>
          <h1>{mode === "register" ? "Create player" : "Select player"}</h1>
          {mode === "register" && (
            <label>
              Display name
              <input autoComplete="name" name="displayName" required maxLength={40} />
            </label>
          )}
          <label>
            Username
            <input autoCapitalize="none" autoComplete="username" name="username" pattern="[a-zA-Z0-9_]{3,20}" required />
          </label>
          <label>
            Password
            <input autoComplete={mode === "register" ? "new-password" : "current-password"} minLength={8} name="password" required type="password" />
          </label>
          {error && <p className={styles.error} role="alert">{error}</p>}
          <button className={styles.primary} disabled={pending} type="submit">
            {pending ? "Connecting…" : mode === "register" ? "Create player" : "Enter"}
          </button>
        </form>
        <p className={styles.localNotice}><span aria-hidden="true" /> Local server connected</p>
      </section>
    </main>
  );
}

function RequireSession({ children }: { children: React.ReactNode }) {
  const session = useSession();
  if (session.isPending)
    return <main className={styles.loading}>Loading your leagues…</main>;
  if (!session.data) return <Navigate to="/welcome" replace />;
  return children;
}

export function Dashboard() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const leagues = useQuery({
    queryKey: ["leagues"],
    queryFn: () => api<{ leagues: LeagueSummaryView[] }>("/api/leagues"),
  });
  const invitations = useQuery({
    queryKey: ["invitations"],
    queryFn: () =>
      api<{ invitations: LeagueInvitationView[] }>("/api/invitations"),
  });
  const [error, setError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  async function createLeague(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const league = await api<LeagueDetailView>("/api/leagues", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: form.get("name") }),
      });
      await queryClient.invalidateQueries({ queryKey: ["leagues"] });
      navigate(`/leagues/${league.id}`);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not create league.",
      );
    }
  }

  return (
    <RequireSession>
      <main className={styles.workspace}>
        <header className={styles.screenHeader}>
          <div>
            <h1>Your leagues</h1>
            <p>{leagues.data?.leagues.length ?? 0} league{leagues.data?.leagues.length === 1 ? "" : "s"}</p>
          </div>
          <button className={styles.iconAction} onClick={() => setCreateOpen((open) => !open)} type="button">
            <GameIcon name="plus" /><span>New</span>
          </button>
        </header>
        {Boolean(invitations.data?.invitations.length) && (
          <Link className={styles.inviteAlert} to="/app/inbox">
            <GameIcon name="mail" />
            <span><strong>New league invitation</strong><small>{invitations.data!.invitations.length} waiting</small></span>
            <b>OPEN</b>
          </Link>
        )}
        {error && <p className={styles.error}>{error}</p>}
        {createOpen && (
          <form className={`${styles.card} ${styles.createPanel}`} onSubmit={createLeague}>
            <div className={styles.panelHeading}><h2>New league</h2><button onClick={() => setCreateOpen(false)} type="button">Close</button></div>
            <label>
              League name
              <input name="name" placeholder="Saturday League" required />
            </label>
            <button className={styles.primary}>Create league</button>
          </form>
        )}
        <section className={styles.leagueList}>
          {leagues.data?.leagues.length ? (
            leagues.data.leagues.map((league, index) => (
              <Link className={styles.leagueRow} key={league.id} to={`/leagues/${league.id}`}>
                <span className={styles.slotNumber}>{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <small>{league.role} · {league.memberCount} player{league.memberCount === 1 ? "" : "s"}</small>
                  <strong>{league.name}</strong>
                  <span>{league.nextTournament?.name ?? "No active event"}</span>
                </div>
                <b>›</b>
              </Link>
            ))
          ) : (
            <div className={styles.empty}>
              <strong>No leagues found</strong>
              <p>Use New to create your first league.</p>
            </div>
          )}
        </section>
      </main>
    </RequireSession>
  );
}

export function InvitationsPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const invitations = useQuery({
    queryKey: ["invitations"],
    queryFn: () => api<{ invitations: LeagueInvitationView[] }>("/api/invitations"),
  });

  async function accept(invitationId: string) {
    setError("");
    try {
      const league = await api<LeagueDetailView>(`/api/invitations/${invitationId}/accept`, { method: "POST" });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["leagues"] }),
        queryClient.invalidateQueries({ queryKey: ["invitations"] }),
      ]);
      navigate(`/leagues/${league.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not join league.");
    }
  }

  return (
    <RequireSession>
      <main className={styles.workspace}>
        <header className={styles.screenHeader}><div><h1>Inbox</h1><p>League invitations</p></div></header>
        {error && <p className={styles.error}>{error}</p>}
        <section className={styles.leagueList}>
          {invitations.data?.invitations.length ? invitations.data.invitations.map((invite) => (
            <article className={styles.inviteRow} key={invite.id}>
              <span className={styles.inviteGlyph}><GameIcon name="mail" /></span>
              <div><small>From {invite.invitedBy.displayName}</small><strong>{invite.leagueName}</strong></div>
              <button onClick={() => accept(invite.id)}>Join</button>
            </article>
          )) : <div className={styles.empty}><strong>No new invitations</strong><p>League invitations will appear here.</p></div>}
        </section>
      </main>
    </RequireSession>
  );
}

export function CupsPage() {
  const leagues = useQuery({
    queryKey: ["leagues"],
    queryFn: () => api<{ leagues: LeagueSummaryView[] }>("/api/leagues"),
  });
  const events = leagues.data?.leagues.flatMap((league) =>
    league.nextTournament ? [{ league, tournament: league.nextTournament }] : [],
  ) ?? [];

  return (
    <RequireSession>
      <main className={styles.workspace}>
        <header className={styles.screenHeader}>
          <div><h1>Cups</h1><p>Current tournaments</p></div>
        </header>
        <section className={styles.eventList}>
          {events.length ? events.map(({ league, tournament }) => (
            <Link className={styles.eventRow} key={tournament.id} to={`/leagues/${league.id}/tournaments/${tournament.id}/team`}>
              <div className={styles.eventStatus}><span />{tournament.status.replaceAll("-", " ")}</div>
              <strong>{tournament.name}</strong>
              <small>{league.name} · Best of {tournament.rules.bestOf} · {tournament.rules.teamSize} Pokémon</small>
              <b>OPEN ›</b>
            </Link>
          )) : <div className={styles.empty}><strong>No active cups</strong><p>Create a tournament from one of your leagues.</p></div>}
        </section>
      </main>
    </RequireSession>
  );
}

export function PlayerPage() {
  const queryClient = useQueryClient();
  const card = useQuery({ queryKey: ["trainer-card"], queryFn: () => api<TrainerCardView>("/api/trainer-card") });
  const [profilePending, setProfilePending] = useState(false);
  const [profileError, setProfileError] = useState("");

  async function chooseTrainerSprite(trainerSprite: TrainerSpriteId) {
    if (profilePending || card.data?.trainerSprite === trainerSprite) return;
    setProfilePending(true);
    setProfileError("");
    try {
      const updated = await api<TrainerCardView>("/api/trainer-card", {
        method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ trainerSprite }),
      });
      queryClient.setQueryData(["trainer-card"], updated);
    } catch (caught) {
      setProfileError(caught instanceof Error ? caught.message : "The trainer sprite could not be changed.");
    } finally {
      setProfilePending(false);
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    queryClient.setQueryData(["session"], null);
    window.location.assign("/welcome");
  }

  return (
    <RequireSession>
      <main className={styles.workspace}>
        <header className={styles.screenHeader}><div><h1>Trainer Card</h1><p>Official league record</p></div></header>
        {card.isPending ? <div className={styles.loading}>Printing trainer card…</div> : card.data && <>
          <section className={styles.trainerLicense}>
            <header><span>POCKET MONSTER BRAWL</span><b>TRAINER</b></header>
            <div className={styles.licenseBody}>
              <div className={styles.trainerPortrait}>
                <img alt={`${card.data.trainerSprite} trainer`} src={`https://play.pokemonshowdown.com/sprites/trainers/${card.data.trainerSprite}.png`} />
                <span>ID {card.data.user.id.slice(0, 8).toUpperCase()}</span>
              </div>
              <div className={styles.trainerIdentity}>
                <small>Registered trainer</small>
                <h2>{card.data.user.displayName}</h2>
                <p>@{card.data.user.username}</p>
                <dl>
                  <div><dt>Leagues</dt><dd>{card.data.stats.leagues}</dd></div>
                  <div><dt>Cups</dt><dd>{card.data.stats.cups}</dd></div>
                  <div><dt>Wins</dt><dd>{card.data.stats.wins}</dd></div>
                  <div><dt>Losses</dt><dd>{card.data.stats.losses}</dd></div>
                </dl>
              </div>
            </div>
            <section className={styles.partnerPanel}>
              {card.data.partner ? <>
                <div><small>Partner Pokémon</small><strong>{card.data.partner.pokemon.nickname || card.data.partner.pokemon.species}</strong><span>Lv.{card.data.partner.pokemon.level} · {card.data.partner.game.replace("Pokemon ", "")}</span></div>
                <img alt={card.data.partner.pokemon.species} src={`https://play.pokemonshowdown.com/sprites/${card.data.partner.pokemon.shiny ? "ani-shiny" : "ani"}/${card.data.partner.pokemon.species.toLowerCase().replace(/[^a-z0-9]+/g, "")}.gif`} />
              </> : <><div><small>Partner Pokémon</small><strong>Not selected</strong><span>Choose one from your Box.</span></div><Link to="/app/box">Open Box</Link></>}
            </section>
          </section>

          <section className={styles.avatarPanel}>
            <header><div><small>Trainer appearance</small><strong>Choose trainer</strong></div><span>{card.data.trainerSprite === "leaf-gen3" ? "leaf" : card.data.trainerSprite}</span></header>
            <div>{trainerSpriteIds.map((sprite) => {
              const label = sprite === "leaf-gen3" ? "leaf" : sprite;
              return <button aria-label={`Use ${label} trainer sprite`} aria-pressed={card.data?.trainerSprite === sprite} disabled={profilePending} key={sprite} onClick={() => chooseTrainerSprite(sprite)} type="button"><img alt="" src={`https://play.pokemonshowdown.com/sprites/trainers/${sprite}.png`} /><span>{label}</span></button>;
            })}</div>
          </section>
          {profileError && <p className={styles.error}>{profileError}</p>}
        </>}
        <div className={styles.systemPanel}>
          <div><span>Server</span><strong>Connected</strong></div>
          <div><span>Save handling</span><strong>Raw files never retained</strong></div>
          <button onClick={logout}>Sign out</button>
        </div>
      </main>
    </RequireSession>
  );
}

export function LeaguePage() {
  const { leagueId = "" } = useParams();
  const queryClient = useQueryClient();
  const league = useQuery({
    queryKey: ["league", leagueId],
    queryFn: () => api<LeagueDetailView>(`/api/leagues/${leagueId}`),
  });
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState("");
  const [section, setSection] = useState<"events" | "players" | "admin">("events");
  const users = useQuery({
    queryKey: ["user-search", search],
    queryFn: () =>
      api<{ users: AccountView[] }>(
        `/api/users/search?q=${encodeURIComponent(search)}`,
      ),
    enabled: search.trim().length >= 2,
  });
  const isAdmin =
    league.data?.currentUserRole === "owner" ||
    league.data?.currentUserRole === "admin";

  async function invite(userId: string) {
    try {
      await api(`/api/leagues/${leagueId}/invitations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      setMessage("Invitation sent.");
    } catch (caught) {
      setMessage(
        caught instanceof Error ? caught.message : "Could not send invitation.",
      );
    }
  }

  async function createTournament(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    try {
      await api(`/api/leagues/${leagueId}/tournaments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...values,
          bestOf: Number(values.bestOf),
          teamSize: Number(values.teamSize),
        }),
      });
      form.reset();
      await queryClient.invalidateQueries({ queryKey: ["league", leagueId] });
      setMessage("Tournament workspace opened.");
    } catch (caught) {
      setMessage(
        caught instanceof Error
          ? caught.message
          : "Could not create tournament.",
      );
    }
  }

  if (league.isPending)
    return <main className={styles.loading}>Opening league…</main>;
  if (!league.data) return <Navigate to="/app/leagues" replace />;
  return (
    <RequireSession>
      <main className={styles.workspace}>
        <Link className={styles.back} to="/app/leagues"><GameIcon name="back" /> Leagues</Link>
        <header className={styles.leagueHeader}>
          <div>
            <h1>{league.data.name}</h1>
            <p>{league.data.members.length} players · {league.data.currentUserRole}</p>
          </div>
          {isAdmin && <button className={styles.iconAction} aria-label="League administration" onClick={() => setSection("admin")} type="button"><GameIcon name="gear" /><span>Admin</span></button>}
        </header>
        {message && <p className={styles.notice}>{message}</p>}
        <div className={styles.sectionTabs} role="tablist" aria-label="League sections">
          <button aria-selected={section === "events"} onClick={() => setSection("events")} role="tab">Events</button>
          <button aria-selected={section === "players"} onClick={() => setSection("players")} role="tab">Players</button>
          {isAdmin && <button aria-selected={section === "admin"} onClick={() => setSection("admin")} role="tab">Admin</button>}
        </div>

        {section === "events" && <section className={styles.eventList}>
          {league.data.tournaments.length ? league.data.tournaments.map((event) => (
            <Link className={styles.eventRow} key={event.id} to={`/leagues/${leagueId}/tournaments/${event.id}/team`}>
              <div className={styles.eventStatus}><span />{event.status.replaceAll("-", " ")}</div>
              <strong>{event.name}</strong>
              <small>Best of {event.rules.bestOf} · Up to {event.rules.teamSize} Pokémon</small>
              <b>OPEN ›</b>
            </Link>
          )) : <div className={styles.empty}><strong>No event scheduled</strong><p>An admin can open the first tournament.</p></div>}
        </section>}

        {section === "players" && <section className={styles.roster}>
          {league.data.members.map((member, index) => (
            <div key={member.user.id}>
              <span>{member.user.displayName.slice(0, 1).toUpperCase()}</span>
              <p><small>Player {String(index + 1).padStart(2, "0")} · {member.role}</small><strong>{member.user.displayName}</strong><em>@{member.user.username}</em></p>
              <b data-state={member.teamStatus}>{member.teamStatus === "submitted" ? "LOCKED" : member.teamStatus.replace("-", " ")}</b>
            </div>
          ))}
        </section>}

        {section === "admin" && isAdmin && (
          <section className={styles.adminGrid}>
              <form className={styles.card} onSubmit={createTournament}>
                <div className={styles.panelHeading}><h2>Open tournament</h2><span>01</span></div>
                <label>
                  Name
                  <input name="name" placeholder="Fall Championship" required />
                </label>
                <div className={styles.fieldRow}>
                  <label>
                    Best of
                    <select defaultValue="3" name="bestOf">
                      <option value="1">1</option>
                      <option value="3">3</option>
                      <option value="5">5</option>
                    </select>
                  </label>
                  <label>
                    Team size
                    <select defaultValue="6" name="teamSize">
                      {[1, 2, 3, 4, 5, 6].map((size) => (
                        <option key={size}>{size}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <label>
                  Starts
                  <input name="startsAt" type="datetime-local" />
                </label>
                <label>
                  Lock deadline
                  <input name="teamLockAt" type="datetime-local" />
                </label>
                <button className={styles.primary}>Open registration</button>
              </form>
              <div className={styles.card}>
                <div className={styles.panelHeading}><h2>Invite player</h2><span>02</span></div>
                <input
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search players…"
                  value={search}
                />
                {users.data?.users.map((user) => (
                  <div className={styles.userResult} key={user.id}>
                    <span>
                      <strong>{user.displayName}</strong>
                      <small>@{user.username}</small>
                    </span>
                    <button onClick={() => invite(user.id)}>Invite</button>
                  </div>
                ))}
              </div>
          </section>
        )}
      </main>
    </RequireSession>
  );
}

export function TournamentTeamPage() {
  const { leagueId = "", tournamentId = "" } = useParams();
  const league = useQuery({
    queryKey: ["league", leagueId],
    queryFn: () => api<LeagueDetailView>(`/api/leagues/${leagueId}`),
  });
  const tournament = league.data?.tournaments.find(
    (event) => event.id === tournamentId,
  );
  const isAdmin = league.data?.currentUserRole === "owner" || league.data?.currentUserRole === "admin";
  if (league.isPending)
    return <main className={styles.loading}>Opening tournament…</main>;
  if (!tournament) return <Navigate to={`/leagues/${leagueId}`} replace />;
  return (
    <RequireSession>
      <div>
        <div className={styles.contextBar}>
          <Link to={`/leagues/${leagueId}`}>← {league.data?.name}</Link>
          <span>{tournament.name} · Private team</span>
        </div>
        <TournamentMatchPanel isAdmin={isAdmin} tournament={tournament} />
        <TournamentTeamBuilder tournament={tournament} />
      </div>
    </RequireSession>
  );
}

function TournamentMatchPanel({ tournament, isAdmin }: { tournament: TournamentView; isAdmin: boolean }) {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState("");
  const [starting, setStarting] = useState(false);
  const match = useQuery({
    queryKey: ["tournament-match", tournament.id],
    queryFn: async () => {
      const response = await fetch(`/api/tournaments/${tournament.id}/match`, { cache: "no-store" });
      if (response.status === 404) return null;
      const body = await response.json() as TournamentMatchView | { error?: string };
      if (!response.ok) throw new Error("error" in body && body.error ? body.error : "The match could not be loaded.");
      return body as TournamentMatchView;
    },
    refetchInterval: 1000,
    retry: false,
  });

  async function startTournament() {
    setMessage("");
    setStarting(true);
    try {
      const started = await api<TournamentMatchView>(`/api/tournaments/${tournament.id}/start`, { method: "POST" });
      queryClient.setQueryData(["tournament-match", tournament.id], started);
      await queryClient.invalidateQueries({ queryKey: ["league", tournament.leagueId] });
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "The tournament could not be started.");
    } finally {
      setStarting(false);
    }
  }

  return (
    <section className={styles.matchPanel}>
      <div>
        <p className={styles.eyebrow}>Event-day match</p>
        {match.data ? <>
          <h2>{match.data.status === "completed" ? `${match.data.winner?.displayName ?? "Winner"} won` : `Game ${match.data.gameNumber} vs. ${match.data.opponent.displayName}`}</h2>
          <p>Series score {match.data.playerWins}–{match.data.opponentWins} · best of {match.data.bestOf}</p>
        </> : <>
          <h2>Waiting for locked teams</h2>
          <p>Once both players lock their teams, the league owner can create the match.</p>
        </>}
        {(message || match.error) && <p className={styles.error}>{message || match.error?.message}</p>}
      </div>
      {match.data?.status === "active" ? (
        <Link className={styles.matchAction} to={`/matches/${match.data.battleId}`}>Join battle →</Link>
      ) : !match.data && isAdmin ? (
        <button className={styles.matchAction} disabled={starting} onClick={startTournament}>
          {starting ? "Starting…" : "Start two-player event"}
        </button>
      ) : null}
    </section>
  );
}
