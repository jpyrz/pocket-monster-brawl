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
} from "@pmb/domain";
import { SaveImport } from "./SaveImport";
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
      <section className={styles.authPitch}>
        <p className={styles.eyebrow}>
          Your cartridge. Your crew. Your bracket.
        </p>
        <h1>
          Build the team.
          <br />
          Keep it secret.
          <br />
          Settle it live.
        </h1>
        <p>
          Create a private league with friends, prepare from your real FireRed
          save, then meet in a server-run tournament.
        </p>
      </section>
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
        <h2>{mode === "register" ? "Join the league" : "Welcome back"}</h2>
        {mode === "register" && (
          <label>
            Display name
            <input
              autoComplete="name"
              name="displayName"
              required
              maxLength={40}
            />
          </label>
        )}
        <label>
          Username
          <input
            autoCapitalize="none"
            autoComplete="username"
            name="username"
            pattern="[a-zA-Z0-9_]{3,20}"
            required
          />
        </label>
        <label>
          Password
          <input
            autoComplete={
              mode === "register" ? "new-password" : "current-password"
            }
            minLength={8}
            name="password"
            required
            type="password"
          />
        </label>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        <button className={styles.primary} disabled={pending} type="submit">
          {pending
            ? "One moment…"
            : mode === "register"
              ? "Create my account"
              : "Sign in"}
        </button>
        <small>
          Your account, leagues, tournaments, and team drafts are stored on this
          development server.
        </small>
      </form>
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

  async function accept(invitationId: string) {
    try {
      const league = await api<LeagueDetailView>(
        `/api/invitations/${invitationId}/accept`,
        { method: "POST" },
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["leagues"] }),
        queryClient.invalidateQueries({ queryKey: ["invitations"] }),
      ]);
      navigate(`/leagues/${league.id}`);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not join league.",
      );
    }
  }

  return (
    <RequireSession>
      <main className={styles.workspace}>
        <header className={styles.pageHeading}>
          <div>
            <p className={styles.eyebrow}>League headquarters</p>
            <h1>Your leagues</h1>
          </div>
          <p>
            Meet your players, prepare privately, and arrive ready on tournament
            day.
          </p>
        </header>
        {invitations.data?.invitations.map((invite) => (
          <article className={styles.invite} key={invite.id}>
            <div>
              <span>League invitation</span>
              <strong>{invite.leagueName}</strong>
              <small>From {invite.invitedBy.displayName}</small>
            </div>
            <button onClick={() => accept(invite.id)}>Join league</button>
          </article>
        ))}
        {error && <p className={styles.error}>{error}</p>}
        <section className={styles.dashboardGrid}>
          <div className={styles.stack}>
            <h2>Active leagues</h2>
            {leagues.data?.leagues.length ? (
              leagues.data.leagues.map((league) => (
                <Link
                  className={styles.leagueRow}
                  key={league.id}
                  to={`/leagues/${league.id}`}
                >
                  <div>
                    <strong>{league.name}</strong>
                    <small>
                      {league.memberCount} player
                      {league.memberCount === 1 ? "" : "s"} · {league.role}
                    </small>
                  </div>
                  <span>
                    {league.nextTournament?.name ?? "Set up first event"} →
                  </span>
                </Link>
              ))
            ) : (
              <div className={styles.empty}>
                <strong>No leagues yet</strong>
                <p>Create one and invite your rivals.</p>
              </div>
            )}
          </div>
          <form className={styles.card} onSubmit={createLeague}>
            <p className={styles.eyebrow}>Start a crew</p>
            <h2>Create a league</h2>
            <label>
              League name
              <input name="name" placeholder="Saturday Link Club" required />
            </label>
            <button className={styles.primary}>Create league</button>
          </form>
        </section>
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
  if (!league.data) return <Navigate to="/app" replace />;
  return (
    <RequireSession>
      <main className={styles.workspace}>
        <Link className={styles.back} to="/app">
          ← All leagues
        </Link>
        <header className={styles.pageHeading}>
          <div>
            <p className={styles.eyebrow}>
              {league.data.currentUserRole} · {league.data.members.length}{" "}
              players
            </p>
            <h1>{league.data.name}</h1>
          </div>
          <p>
            Rosters are visible. Teams stay hidden until battle reveals them.
          </p>
        </header>
        {message && <p className={styles.notice}>{message}</p>}
        <section className={styles.dashboardGrid}>
          <div className={styles.stack}>
            <h2>Tournaments</h2>
            {league.data.tournaments.length ? (
              league.data.tournaments.map((event) => (
                <article className={styles.eventRow} key={event.id}>
                  <div>
                    <span>{event.status.replace("-", " ")}</span>
                    <strong>{event.name}</strong>
                    <small>
                      Best of {event.rules.bestOf} · {event.rules.teamSize}{" "}
                      Pokémon · single elimination
                    </small>
                  </div>
                  <Link
                    to={`/leagues/${leagueId}/tournaments/${event.id}/team`}
                  >
                    Prepare team →
                  </Link>
                </article>
              ))
            ) : (
              <div className={styles.empty}>
                <strong>No tournament scheduled</strong>
                <p>An admin can open the first event.</p>
              </div>
            )}
            <h2>Players</h2>
            <div className={styles.roster}>
              {league.data.members.map((member) => (
                <div key={member.user.id}>
                  <span>
                    {member.user.displayName.slice(0, 1).toUpperCase()}
                  </span>
                  <p>
                    <strong>{member.user.displayName}</strong>
                    <small>
                      @{member.user.username} · {member.role}
                    </small>
                  </p>
                  <em>{member.teamStatus.replace("-", " ")}</em>
                </div>
              ))}
            </div>
          </div>
          {isAdmin && (
            <aside className={styles.stack}>
              <form className={styles.card} onSubmit={createTournament}>
                <p className={styles.eyebrow}>Admin controls</p>
                <h2>Open a tournament</h2>
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
                  Starts at
                  <input name="startsAt" type="datetime-local" />
                </label>
                <label>
                  Team lock
                  <input name="teamLockAt" type="datetime-local" />
                </label>
                <button className={styles.primary}>Open registration</button>
              </form>
              <div className={styles.card}>
                <p className={styles.eyebrow}>Invite player</p>
                <h2>Find by username</h2>
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
            </aside>
          )}
        </section>
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
    return <main className={styles.loading}>Opening team room…</main>;
  if (!tournament) return <Navigate to={`/leagues/${leagueId}`} replace />;
  return (
    <RequireSession>
      <div>
        <div className={styles.contextBar}>
          <Link to={`/leagues/${leagueId}`}>← {league.data?.name}</Link>
          <span>{tournament.name} · Private team room</span>
        </div>
        <TournamentMatchPanel isAdmin={isAdmin} tournament={tournament} />
        <SaveImport tournament={tournament} />
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
