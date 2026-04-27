(function () {
  const TOTAL_RODADA = 10;
  const OPCOES = 4;
  const BASE_FLAG = "https://flagcdn.com/w320/";

  /** Tempo máximo por questão (ms) — respostas rápidas rendem mais pontos */
  const TEMPO_QUESTAO_MS = 15000;
  /** Pausa após revelar resultado antes do fade para a próxima */
  const PAUSA_APOS_RESPOSTA_MS = 2200;
  /** Duração do fade out / entrada */
  const FADE_MS = 380;

  const paises = window.PAISES_QUIZ.slice();

  /** @type {'flag-to-name' | 'name-to-flag' | null} */
  let modo = null;
  let rodada = [];
  let indice = 0;
  let pontos = 0;
  let acertos = 0;
  let erros = 0;

  let questionStartMs = 0;
  let responded = false;
  /** @type {ReturnType<typeof setInterval> | null} */
  let tickId = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let advanceId = null;

  const el = (id) => document.getElementById(id);

  function flagUrl(code) {
    return BASE_FLAG + code + ".png";
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function amostraResposta(correto, n) {
    const outros = shuffle(paises.filter((p) => p.code !== correto.code)).slice(
      0,
      n - 1
    );
    return shuffle([correto, ...outros]);
  }

  function showScreen(id) {
    document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
    el(id).classList.add("active");
  }

  function atualizarProgresso() {
    const atual = indice + 1;
    el("progress-text").textContent = `Questão ${atual} de ${TOTAL_RODADA}`;
    el("progress-fill").style.width = `${(atual / TOTAL_RODADA) * 100}%`;
    const bar = el("progress-fill").parentElement;
    bar.setAttribute("aria-valuenow", String(atual));
    bar.setAttribute("aria-valuemax", String(TOTAL_RODADA));
  }

  function limparTimersQuiz() {
    if (tickId !== null) {
      clearInterval(tickId);
      tickId = null;
    }
    if (advanceId !== null) {
      clearTimeout(advanceId);
      advanceId = null;
    }
  }

  function atualizarBarraTempo(restanteRatio) {
    const pct = Math.max(0, Math.min(100, restanteRatio * 100));
    const fill = el("timer-fill");
    const secEl = el("timer-seconds");
    fill.style.width = pct + "%";
    const segRestantes = Math.ceil((restanteRatio * TEMPO_QUESTAO_MS) / 1000);
    secEl.textContent = String(Math.max(0, segRestantes));
    const urgente = restanteRatio <= 0.22;
    fill.classList.toggle("urgent", urgente);
    secEl.classList.toggle("urgent", urgente);
  }

  function resetTimerVisual() {
    atualizarBarraTempo(1);
  }

  function iniciarCronometro() {
    resetTimerVisual();
    responded = false;
    questionStartMs = performance.now();
    tickId = setInterval(() => {
      if (responded) return;
      const elapsed = performance.now() - questionStartMs;
      const restante = Math.max(0, TEMPO_QUESTAO_MS - elapsed);
      const ratio = restante / TEMPO_QUESTAO_MS;
      atualizarBarraTempo(ratio);
      if (restante <= 0) {
        tratarTempoEsgotado();
      }
    }, 50);
  }

  /** @returns {number} pontos ganhos (positivo) ou perdidos (negativo) no acerto/erro */
  function aplicarPontuacao(acertou, elapsedMs) {
    if (acertou) {
      acertos++;
      const capped = Math.min(elapsedMs, TEMPO_QUESTAO_MS);
      const ratio = Math.max(0, (TEMPO_QUESTAO_MS - capped) / TEMPO_QUESTAO_MS);
      const ganho = Math.floor(350 + ratio * 550);
      pontos += ganho;
      return ganho;
    }
    erros++;
    const perda = 120;
    pontos = Math.max(0, pontos - perda);
    return -perda;
  }

  function destacarCorreto(codigoCorreto) {
    if (modo === "flag-to-name") {
      el("choices-text").querySelectorAll("button").forEach((b) => {
        b.disabled = true;
        if (b.dataset.code === codigoCorreto) b.classList.add("correct");
      });
    } else {
      el("choices-flags").querySelectorAll("button").forEach((b) => {
        b.disabled = true;
        if (b.dataset.code === codigoCorreto) b.classList.add("correct");
      });
    }
  }

  function tratarTempoEsgotado() {
    if (responded) return;
    responded = true;
    limparTimersQuiz();
    const p = rodada[indice];
    destacarCorreto(p.code);
    const delta = aplicarPontuacao(false, TEMPO_QUESTAO_MS);
    mostrarFeedback(false, delta, true);
  }

  function limparFeedback() {
    const fb = el("feedback");
    fb.classList.add("hidden");
    fb.classList.remove("ok", "bad");
    fb.textContent = "";
  }

  function bindHome() {
    document.querySelectorAll(".mode-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".mode-btn").forEach((b) => b.classList.remove("selected"));
        btn.classList.add("selected");
        modo = /** @type {'flag-to-name' | 'name-to-flag'} */ (btn.dataset.mode);
      });
    });

    el("btn-start").addEventListener("click", () => {
      if (!modo) {
        const first = document.querySelector(".mode-btn");
        if (first) {
          first.classList.add("selected");
          modo = /** @type {'flag-to-name' | 'name-to-flag'} */ (first.dataset.mode);
        } else return;
      }
      iniciarRodada();
    });
  }

  function iniciarRodada() {
    limparTimersQuiz();
    indice = 0;
    pontos = 0;
    acertos = 0;
    erros = 0;
    rodada = shuffle(paises).slice(0, TOTAL_RODADA);
    el("flag-to-name-view").classList.add("hidden");
    el("name-to-flag-view").classList.add("hidden");
    if (modo === "flag-to-name") {
      el("flag-to-name-view").classList.remove("hidden");
      el("question-prompt").textContent = "De qual país é essa bandeira?";
    } else {
      el("name-to-flag-view").classList.remove("hidden");
      el("question-prompt").textContent = "Qual é a bandeira deste país?";
    }
    const panel = el("quiz-panel");
    panel.classList.remove("fade-out", "fade-in");
    showScreen("screen-quiz");
    atualizarProgresso();
    renderQuestao(false);
  }

  /**
   * @param {boolean} animateIn — fade de entrada (após transição entre questões)
   */
  function renderQuestao(animateIn) {
    limparTimersQuiz();
    limparFeedback();
    const panel = el("quiz-panel");
    if (!animateIn) {
      panel.classList.remove("fade-out", "fade-in");
    } else {
      panel.classList.remove("fade-in");
    }

    const p = rodada[indice];
    const opcoes = amostraResposta(p, OPCOES);

    if (modo === "flag-to-name") {
      el("question-flag").src = flagUrl(p.code);
      el("question-flag").alt = "Bandeira para adivinhar";

      const container = el("choices-text");
      container.innerHTML = "";
      opcoes.forEach((opt) => {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = opt.nome;
        b.dataset.code = opt.code;
        b.addEventListener("click", () => responderNome(b, p.code));
        container.appendChild(b);
      });
    } else {
      el("country-name-display").textContent = p.nome;

      const container = el("choices-flags");
      container.innerHTML = "";
      opcoes.forEach((opt) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "choice-flag-btn";
        b.dataset.code = opt.code;
        b.setAttribute("aria-label", "Escolher bandeira");
        const img = document.createElement("img");
        img.src = flagUrl(opt.code);
        img.alt = "";
        img.loading = "lazy";
        b.appendChild(img);
        b.addEventListener("click", () => responderBandeira(b, p.code));
        container.appendChild(b);
      });
    }

    atualizarProgresso();

    if (animateIn) {
      panel.classList.remove("fade-out");
      panel.classList.add("fade-in");
      panel.addEventListener(
        "animationend",
        function onAnim() {
          panel.removeEventListener("animationend", onAnim);
          panel.classList.remove("fade-in");
        },
        { once: true }
      );
    }

    iniciarCronometro();
  }

  function montarTextoFeedback(acertou, deltaPts, tempoEsgotado) {
    if (tempoEsgotado) return "✗ Tempo esgotado!";
    if (acertou) return `✓ Correto! +${deltaPts} pts`;
    return "✗ Errado!";
  }

  function responderNome(btn, codigoCorreto) {
    if (responded) return;
    responded = true;
    limparTimersQuiz();
    const elapsed = Math.min(performance.now() - questionStartMs, TEMPO_QUESTAO_MS);
    const container = el("choices-text");
    const botoes = container.querySelectorAll("button");
    const acertou = btn.dataset.code === codigoCorreto;
    botoes.forEach((b) => {
      b.disabled = true;
      if (b.dataset.code === codigoCorreto) b.classList.add("correct");
      else if (b === btn && !acertou) b.classList.add("wrong");
    });
    const delta = aplicarPontuacao(acertou, elapsed);
    mostrarFeedback(acertou, delta, false);
  }

  function responderBandeira(btn, codigoCorreto) {
    if (responded) return;
    responded = true;
    limparTimersQuiz();
    const elapsed = Math.min(performance.now() - questionStartMs, TEMPO_QUESTAO_MS);
    const container = el("choices-flags");
    const botoes = container.querySelectorAll("button");
    const acertou = btn.dataset.code === codigoCorreto;
    botoes.forEach((b) => {
      b.disabled = true;
      if (b.dataset.code === codigoCorreto) b.classList.add("correct");
      else if (b === btn && !acertou) b.classList.add("wrong");
    });
    const delta = aplicarPontuacao(acertou, elapsed);
    mostrarFeedback(acertou, delta, false);
  }

  /**
   * @param {boolean} acertou
   * @param {number} deltaPts
   * @param {boolean} [tempoEsgotado]
   */
  function mostrarFeedback(acertou, deltaPts, tempoEsgotado) {
    const fb = el("feedback");
    fb.classList.remove("hidden");
    fb.classList.toggle("ok", Boolean(acertou && !tempoEsgotado));
    fb.classList.toggle("bad", Boolean(!acertou || tempoEsgotado));
    fb.textContent = montarTextoFeedback(acertou, deltaPts, Boolean(tempoEsgotado));
    agendarProximaQuestao();
  }

  function agendarProximaQuestao() {
    advanceId = setTimeout(() => {
      advanceId = null;
      const panel = el("quiz-panel");
      panel.classList.add("fade-out");
      setTimeout(() => {
        panel.classList.remove("fade-out");
        indice++;
        if (indice >= rodada.length) {
          finalizar();
          return;
        }
        renderQuestao(true);
      }, FADE_MS);
    }, PAUSA_APOS_RESPOSTA_MS);
  }

  function finalizar() {
    limparTimersQuiz();
    const xp = acertos * 12 + Math.min(80, Math.floor(pontos / 100));
    el("end-points").textContent = pontos.toLocaleString("pt-BR");
    el("end-correct").textContent = String(acertos);
    el("end-wrong").textContent = String(erros);
    el("end-xp").textContent = "+" + xp;
    showScreen("screen-end");
    if (window.FlagQuizAuth && modo) {
      window.FlagQuizAuth.submitMatch({
        score: pontos,
        xp,
        correct: acertos,
        wrong: erros,
        mode: modo,
      });
    }
  }

  el("btn-play-again").addEventListener("click", iniciarRodada);
  el("btn-home").addEventListener("click", () => {
    limparTimersQuiz();
    showScreen("screen-home");
    if (window.FlagQuizAuth && window.FlagQuizAuth.refreshChip) {
      window.FlagQuizAuth.refreshChip();
    }
  });

  bindHome();

  const primeiroModo = document.querySelector(".mode-btn.selected");
  if (primeiroModo && primeiroModo.dataset.mode) {
    modo = /** @type {'flag-to-name' | 'name-to-flag'} */ (primeiroModo.dataset.mode);
  }
})();
