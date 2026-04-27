(function () {
  const USER_KEY = "flagquiz_user_json";

  /** @type {any} */
  let sb = null;
  /** @type {any} */
  let cachedSession = null;

  function getUrlAndKey() {
    var url = window.FLAGQUIZ_SUPABASE_URL;
    var key = window.FLAGQUIZ_SUPABASE_ANON_KEY;
    if (!url || !key) return null;
    return { url: String(url).trim(), key: String(key).trim() };
  }

  function createClientFromGlobal() {
    var cfg = getUrlAndKey();
    if (!cfg) return null;
    var g = typeof supabase !== "undefined" ? supabase : window.supabase;
    if (!g || typeof g.createClient !== "function") {
      console.error("Supabase JS não carregou (ver script CDN).");
      return null;
    }
    return g.createClient(cfg.url, cfg.key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }

  function cacheUserFromSession(session) {
    cachedSession = session;
    var u = session && session.user;
    if (!u) {
      localStorage.removeItem(USER_KEY);
      return;
    }
    var meta = u.user_metadata || {};
    var displayName =
      meta.display_name ||
      meta.displayName ||
      (u.email ? String(u.email).split("@")[0] : "Jogador");
    localStorage.setItem(
      USER_KEY,
      JSON.stringify({
        id: u.id,
        email: u.email,
        displayName: displayName,
      })
    );
  }

  function getToken() {
    return cachedSession && cachedSession.access_token ? cachedSession.access_token : null;
  }

  function getStoredUser() {
    try {
      var raw = localStorage.getItem(USER_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function refreshChip() {
    var chip = document.getElementById("auth-chip");
    if (!chip) return;
    var u = getStoredUser();
    if (u && u.displayName) {
      chip.textContent = u.displayName;
      chip.classList.remove("muted");
      chip.classList.add("auth-chip-in");
    } else {
      chip.textContent = "Convidado";
      chip.classList.add("muted");
      chip.classList.remove("auth-chip-in");
    }
  }

  function setupAuthListener() {
    if (!sb) return;
    sb.auth.onAuthStateChange(function (_event, session) {
      cacheUserFromSession(session);
      refreshChip();
      var sync = window.FlagQuizAuth && window.FlagQuizAuth.syncAccountPanel;
      if (sync) sync();
    });
  }

  /** Sessão actual — não confiar só em cache (corrida com o fim do jogo). */
  async function refreshSessionFromServer() {
    if (!sb) return null;
    var result = await sb.auth.getSession();
    cacheUserFromSession(result.data.session);
    refreshChip();
    return result.data.session;
  }

  async function submitMatch(payload) {
    if (!sb) {
      console.warn("FlagQuiz: Supabase não inicializado (supabase-config.js?).");
      return;
    }
    var session = await refreshSessionFromServer();
    if (!session || !session.user) {
      console.warn(
        "FlagQuiz: sem sessão ao gravar partida. Entre em Conta ou confirme o e-mail."
      );
      return;
    }
    var uid = session.user.id;
    var row = {
      user_id: uid,
      score: Math.floor(payload.score),
      xp: Math.floor(payload.xp),
      correct: Math.floor(payload.correct),
      wrong: Math.floor(payload.wrong),
      mode: payload.mode,
    };
    var ins = await sb.from("matches").insert(row).select("id");
    if (ins.error) {
      console.error("FlagQuiz: erro ao gravar partida:", ins.error.message, ins.error);
      return;
    }
    if (!ins.data || !ins.data.length) {
      console.warn("FlagQuiz: insert sem linha devolvida (RLS?).");
    }
  }

  async function loadLeaderboard() {
    var tbody = document.getElementById("leaderboard-body");
    var hint = document.getElementById("leaderboard-hint");
    var sinceEl = document.getElementById("leaderboard-since");
    if (!tbody) return;
    tbody.innerHTML =
      '<tr><td colspan="4" class="table-muted">A carregar…</td></tr>';

    if (!sb) {
      tbody.innerHTML =
        '<tr><td colspan="4" class="table-muted">Supabase não carregou. Confirme que <code>supabase-config.js</code> existe, a chave no ficheiro está certa e que abre o site por <code>https://</code> (não <code>file://</code>).</td></tr>';
      return;
    }

    try {
      var res = await sb.rpc("leaderboard_week", { p_limit: 20 });
      if (res.error) throw res.error;
      var rows = res.data || [];
      if (sinceEl && rows.length && rows[0].week_start) {
        var ws = new Date(rows[0].week_start);
        sinceEl.textContent =
          "Semana atual (UTC, desde " +
          ws.toLocaleDateString("pt-BR", {
            weekday: "long",
            day: "numeric",
            month: "short",
          }) +
          ")";
      } else if (sinceEl) {
        sinceEl.textContent = "Semana actual (UTC).";
      }

      if (!rows.length) {
        tbody.innerHTML =
          '<tr><td colspan="4" class="table-muted">Ainda não há pontuações esta semana.</td></tr>';
        return;
      }

      tbody.innerHTML = "";
      rows.forEach(function (row) {
        var tr = document.createElement("tr");
        var when = new Date(row.played_at);
        tr.innerHTML =
          "<td>" +
          escapeHtml(String(row.rank)) +
          "</td>" +
          "<td>" +
          escapeHtml(row.display_name) +
          "</td>" +
          "<td>" +
          Number(row.score).toLocaleString("pt-BR") +
          "</td>" +
          "<td>" +
          when.toLocaleString("pt-BR", {
            day: "2-digit",
            month: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
          }) +
          "</td>";
        tbody.appendChild(tr);
      });
      if (hint) hint.textContent = "";
    } catch (e) {
      var msg =
        e && e.message
          ? e.message
          : "Erro ao carregar ranking.";
      tbody.innerHTML =
        '<tr><td colspan="4" class="table-muted">' +
        escapeHtml(msg) +
        " Executou <code>supabase/schema.sql</code> no painel?</td></tr>";
      if (hint) hint.textContent = "";
    }
  }

  async function loadHistory() {
    var tbody = document.getElementById("history-body");
    if (!tbody) return;
    tbody.innerHTML =
      '<tr><td colspan="5" class="table-muted">A carregar…</td></tr>';
    if (!sb) {
      tbody.innerHTML =
        '<tr><td colspan="5" class="table-muted">Supabase não inicializado.</td></tr>';
      return;
    }
    await refreshSessionFromServer();
    if (!getToken()) {
      tbody.innerHTML =
        '<tr><td colspan="5" class="table-muted">Inicie sessão para ver o histórico.</td></tr>';
      return;
    }
    try {
      var q = await sb
        .from("matches")
        .select("score,xp,correct,wrong,mode,played_at")
        .order("played_at", { ascending: false })
        .limit(10);
      if (q.error) throw q.error;
      var rows = q.data || [];
      if (!rows.length) {
        tbody.innerHTML =
          '<tr><td colspan="5" class="table-muted">Ainda não jogou partidas com esta conta.</td></tr>';
        return;
      }
      tbody.innerHTML = "";
      var modeLabel = function (m) {
        return m === "name-to-flag" ? "Nome → Bandeira" : "Bandeira → Nome";
      };
      rows.forEach(function (row) {
        var tr = document.createElement("tr");
        var when = new Date(row.played_at);
        tr.innerHTML =
          "<td>" +
          when.toLocaleString("pt-BR", {
            day: "2-digit",
            month: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
          }) +
          "</td>" +
          "<td>" +
          Number(row.score).toLocaleString("pt-BR") +
          "</td>" +
          "<td>" +
          row.correct +
          "</td>" +
          "<td>" +
          row.wrong +
          "</td>" +
          "<td>" +
          escapeHtml(modeLabel(row.mode)) +
          "</td>";
        tbody.appendChild(tr);
      });
    } catch (e) {
      tbody.innerHTML =
        '<tr><td colspan="5" class="table-muted">' +
        escapeHtml(e.message || "Erro") +
        "</td></tr>";
    }
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  async function loadProfileFormFields() {
    var form = document.getElementById("form-profile");
    if (!form || !sb) return;
    await refreshSessionFromServer();
    var uid = cachedSession && cachedSession.user && cachedSession.user.id;
    if (!uid) return;
    var msg = document.getElementById("profile-save-msg");
    if (msg) {
      msg.textContent = "";
      msg.classList.remove("form-success");
    }
    var q = await sb.from("profiles").select("country, age").eq("id", uid).maybeSingle();
    if (q.error) {
      console.warn("FlagQuiz: perfil:", q.error.message);
      return;
    }
    var row = q.data;
    var countryIn = form.querySelector('[name="country"]');
    var ageIn = form.querySelector('[name="age"]');
    if (countryIn) countryIn.value = row && row.country ? String(row.country) : "";
    if (ageIn)
      ageIn.value =
        row != null && row.age != null && row.age !== "" ? String(row.age) : "";
  }

  function bindAccountForms() {
    var errReg = document.getElementById("account-error-register");
    var errLog = document.getElementById("account-error-login");
    var formReg = document.getElementById("form-register");
    var formLog = document.getElementById("form-login");
    var showRegister = document.getElementById("link-show-register");
    var showLogin = document.getElementById("link-show-login");
    var blockReg = document.getElementById("block-register");
    var blockLog = document.getElementById("block-login");
    var btnLogout = document.getElementById("btn-logout");
    var loggedView = document.getElementById("account-logged");
    var guestView = document.getElementById("account-guest");

    function showGuestForms(showRegisterFirst) {
      if (loggedView) loggedView.classList.add("hidden");
      if (guestView) guestView.classList.remove("hidden");
      if (showRegisterFirst) {
        if (blockReg) blockReg.classList.remove("hidden");
        if (blockLog) blockLog.classList.add("hidden");
      } else {
        if (blockLog) blockLog.classList.remove("hidden");
        if (blockReg) blockReg.classList.add("hidden");
      }
      if (errReg) errReg.textContent = "";
      if (errLog) errLog.textContent = "";
    }

    function showLogged(user) {
      if (guestView) guestView.classList.add("hidden");
      if (loggedView) loggedView.classList.remove("hidden");
      var nameEl = document.getElementById("account-display-name");
      if (nameEl) nameEl.textContent = user.displayName || user.display_name || "";
    }

    function syncAccountPanel() {
      var u = getStoredUser();
      if (getToken() && u) {
        showLogged(u);
        loadProfileFormFields();
      } else showGuestForms(false);
    }

    var formProfile = document.getElementById("form-profile");
    formProfile &&
      formProfile.addEventListener("submit", async function (e) {
        e.preventDefault();
        var msg = document.getElementById("profile-save-msg");
        if (msg) {
          msg.textContent = "";
          msg.classList.remove("form-success");
        }
        if (!sb) {
          if (msg) msg.textContent = "Supabase não configurado.";
          return;
        }
        await refreshSessionFromServer();
        var uid = cachedSession && cachedSession.user && cachedSession.user.id;
        if (!uid) {
          if (msg) msg.textContent = "Inicie sessão novamente.";
          return;
        }
        var fd = new FormData(formProfile);
        var country = String(fd.get("country") || "")
          .trim()
          .slice(0, 80);
        var ageRaw = fd.get("age");
        var age =
          ageRaw === "" || ageRaw == null
            ? null
            : parseInt(String(ageRaw), 10);
        if (age != null && (isNaN(age) || age < 6 || age > 120)) {
          if (msg) msg.textContent = "Idade entre 6 e 120 anos, ou deixe vazio.";
          return;
        }
        var payload = {
          country: country || null,
          age: age,
          updated_at: new Date().toISOString(),
        };
        var up = await sb.from("profiles").update(payload).eq("id", uid);
        if (up.error) {
          if (msg) msg.textContent = up.error.message || "Erro ao guardar.";
          return;
        }
        if (msg) {
          msg.textContent = "Perfil guardado.";
          msg.classList.add("form-success");
        }
      });

    showRegister &&
      showRegister.addEventListener("click", function (e) {
        e.preventDefault();
        showGuestForms(true);
      });
    showLogin &&
      showLogin.addEventListener("click", function (e) {
        e.preventDefault();
        showGuestForms(false);
      });

    formReg &&
      formReg.addEventListener("submit", async function (e) {
        e.preventDefault();
        if (errReg) errReg.textContent = "";
        if (!sb) {
          if (errReg) errReg.textContent = "Supabase não configurado.";
          return;
        }
        var fd = new FormData(formReg);
        var email = fd.get("email");
        var password = fd.get("password");
        var displayName = fd.get("displayName");
        try {
          var sign = await sb.auth.signUp({
            email: String(email),
            password: String(password),
            options: {
              data: { display_name: String(displayName).trim() },
            },
          });
          if (sign.error) throw sign.error;
          if (!sign.data.session) {
            if (errReg)
              errReg.textContent =
                "Conta criada. Se o projecto exigir confirmação de e-mail, abra a mensagem antes de entrar.";
            return;
          }
          cacheUserFromSession(sign.data.session);
          refreshChip();
          syncAccountPanel();
          document.dispatchEvent(new CustomEvent("flagquiz-auth-change"));
        } catch (err) {
          if (errReg) errReg.textContent = err.message || "Erro ao registar.";
        }
      });

    formLog &&
      formLog.addEventListener("submit", async function (e) {
        e.preventDefault();
        if (errLog) errLog.textContent = "";
        if (!sb) {
          if (errLog) errLog.textContent = "Supabase não configurado.";
          return;
        }
        var fd = new FormData(formLog);
        var email = fd.get("email");
        var password = fd.get("password");
        try {
          var sign = await sb.auth.signInWithPassword({
            email: String(email),
            password: String(password),
          });
          if (sign.error) throw sign.error;
          cacheUserFromSession(sign.data.session);
          refreshChip();
          syncAccountPanel();
          document.dispatchEvent(new CustomEvent("flagquiz-auth-change"));
        } catch (err) {
          if (errLog) errLog.textContent = err.message || "Erro ao iniciar sessão.";
        }
      });

    btnLogout &&
      btnLogout.addEventListener("click", async function () {
        if (sb) await sb.auth.signOut();
        cachedSession = null;
        localStorage.removeItem(USER_KEY);
        refreshChip();
        syncAccountPanel();
        document.dispatchEvent(new CustomEvent("flagquiz-auth-change"));
      });

    window.FlagQuizAuth = {
      getToken: getToken,
      submitMatch: submitMatch,
      refreshChip: refreshChip,
      loadLeaderboard: loadLeaderboard,
      loadHistory: loadHistory,
      syncAccountPanel: syncAccountPanel,
      refreshSessionFromServer: refreshSessionFromServer,
      loadProfileFormFields: loadProfileFormFields,
    };
  }

  bindAccountForms();

  /** Arranque logo ao carregar o script (antes do DOM), para sessão existir ao terminar o jogo. */
  sb = createClientFromGlobal();
  setupAuthListener();
  refreshSessionFromServer().then(function () {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", function () {
        refreshChip();
        var sync = window.FlagQuizAuth && window.FlagQuizAuth.syncAccountPanel;
        if (sync) sync();
      });
    } else {
      refreshChip();
      var sync2 = window.FlagQuizAuth && window.FlagQuizAuth.syncAccountPanel;
      if (sync2) sync2();
    }
  });
})();
