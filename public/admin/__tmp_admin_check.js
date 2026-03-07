
    tailwind.config = {
      theme: {
        extend: {
          colors: {
            primary: "#514DF7",
            "background-light": "#f8f6f6"
          },
          fontFamily: {
            display: ["Public Sans", "sans-serif"]
          },
          borderRadius: {
            DEFAULT: "0.25rem",
            lg: "0.5rem",
            xl: "0.75rem",
            full: "9999px"
          }
        }
      }
    };
  </script>
  <style>
    body {
      font-family: "Public Sans", sans-serif;
    }

    .material-symbols-outlined {
      font-family: "Material Symbols Outlined";
      font-weight: normal;
      font-style: normal;
      font-size: 24px;
      line-height: 1;
      letter-spacing: normal;
      text-transform: none;
      display: inline-block;
      white-space: nowrap;
      word-wrap: normal;
      direction: ltr;
      font-feature-settings: "liga";
      -webkit-font-feature-settings: "liga";
      -webkit-font-smoothing: antialiased;
      font-variation-settings: "FILL" 0, "wght" 400, "GRAD" 0, "opsz" 24;
    }
  </style>
</head>
<body class="bg-background-light text-slate-900">
  <div class="flex min-h-screen">
    <aside class="hidden lg:flex w-64 bg-white border-r border-slate-200 flex-col shrink-0">
      <div class="p-6">
        <div class="flex items-center gap-3 mb-8">
          <div class="bg-primary p-2 rounded-lg text-white">
            <span class="material-symbols-outlined block">dashboard_customize</span>
          </div>
          <div>
            <h1 class="text-lg font-bold tracking-tight">AdminPanel</h1>
            <p class="text-xs text-slate-500">РЈРїСЂР°РІР»РµРЅРёРµ РїР»Р°С‚С„РѕСЂРјРѕР№</p>
          </div>
        </div>
        <nav class="space-y-1">
          <a class="flex items-center gap-3 px-4 py-3 rounded-xl bg-primary/10 text-primary font-semibold" href="/admin/users">
            <span class="material-symbols-outlined">group</span>
            <span class="text-sm">РџРѕР»СЊР·РѕРІР°С‚РµР»Рё</span>
          </a>
          <button disabled class="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-slate-400 text-left cursor-not-allowed">
            <span class="material-symbols-outlined">receipt_long</span>
            <span class="text-sm">РўР°СЂРёС„С‹</span>
          </button>
          <button disabled class="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-slate-400 text-left cursor-not-allowed">
            <span class="material-symbols-outlined">analytics</span>
            <span class="text-sm">РђРЅР°Р»РёС‚РёРєР°</span>
          </button>
          <button disabled class="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-slate-400 text-left cursor-not-allowed">
            <span class="material-symbols-outlined">settings</span>
            <span class="text-sm">РќР°СЃС‚СЂРѕР№РєРё</span>
          </button>
        </nav>
      </div>
      <div class="mt-auto p-6 border-t border-slate-200">
        <div class="flex items-center gap-3">
          <div class="size-10 rounded-full bg-primary/10 text-primary flex items-center justify-center font-semibold">
            A
          </div>
          <div class="overflow-hidden">
            <p id="adminName" class="text-sm font-semibold truncate">РђРґРјРёРЅРёСЃС‚СЂР°С‚РѕСЂ</p>
            <p id="adminEmail" class="text-xs text-slate-500 truncate">admin@platform.com</p>
          </div>
        </div>
      </div>
    </aside>

    <main class="flex-1 flex flex-col min-w-0 bg-background-light">
      <header class="h-16 flex items-center justify-between px-4 sm:px-6 lg:px-8 bg-white border-b border-slate-200 sticky top-0 z-10">
        <div class="flex items-center gap-4 min-w-0">
          <h2 class="text-lg font-bold truncate">РЈРїСЂР°РІР»РµРЅРёРµ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏРјРё</h2>
        </div>
        <div class="flex items-center gap-3 sm:gap-4">
          <div class="relative w-44 sm:w-64">
            <span class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-lg">search</span>
            <input id="searchInput" class="w-full pl-10 pr-4 py-2 bg-slate-100 border-none rounded-xl text-sm focus:ring-2 focus:ring-primary/40" placeholder="РџРѕРёСЃРє РїРѕР»СЊР·РѕРІР°С‚РµР»РµР№..." type="text" />
          </div>
          <button id="signOutBtn" class="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-sm font-semibold text-slate-600">
            <span class="material-symbols-outlined text-[18px]">logout</span>
            <span class="hidden sm:inline">Р’С‹Р№С‚Рё</span>
          </button>
        </div>
      </header>

      <div class="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto w-full">
        <div class="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-6">
          <div>
            <h3 class="text-2xl sm:text-3xl font-extrabold tracking-tight">Р’СЃРµ Р·Р°СЂРµРіРёСЃС‚СЂРёСЂРѕРІР°РЅРЅС‹Рµ Р°РєРєР°СѓРЅС‚С‹</h3>
            <p class="text-slate-500 mt-1">РџРµСЂРІС‹Р№ СЌС‚Р°Рї: РѕР±С‰РёР№ Р±РѕСЂРґ Р°РґРјРёРЅ-РїР°РЅРµР»Рё СЃ С‚Р°Р±Р»РёС†РµР№ РїРѕР»СЊР·РѕРІР°С‚РµР»РµР№.</p>
          </div>
          <div class="flex gap-3">
            <button id="refreshBtn" class="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm font-semibold hover:bg-slate-50 transition-colors shadow-sm">
              <span class="material-symbols-outlined text-lg">refresh</span>
              РћР±РЅРѕРІРёС‚СЊ
            </button>
            <button id="exportBtn" class="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-xl text-sm font-semibold hover:bg-primary/90 transition-colors shadow-lg shadow-primary/20">
              <span class="material-symbols-outlined text-lg">download</span>
              Р­РєСЃРїРѕСЂС‚
            </button>
          </div>
        </div>

        <div id="notice" class="hidden mb-4 rounded-xl border px-4 py-3 text-sm"></div>

        <div class="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm shadow-slate-200/50">
          <div class="overflow-x-auto">
            <table class="w-full text-left border-collapse min-w-[900px]">
              <thead>
                <tr class="bg-slate-50">
                  <th class="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ</th>
                  <th class="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Email</th>
                  <th class="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Р”Р°С‚Р° СЂРµРіРёСЃС‚СЂР°С†РёРё</th>
                  <th class="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">РўРµРєСѓС‰РёР№ С‚Р°СЂРёС„</th>
                  <th class="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">РЎС‚Р°С‚СѓСЃ</th>
                  <th class="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-right">Р”РµР№СЃС‚РІРёСЏ</th>
                </tr>
              </thead>
              <tbody id="tableBody" class="divide-y divide-slate-100"></tbody>
            </table>
          </div>

          <div class="px-6 py-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between gap-3">
            <p id="paginationMeta" class="text-sm text-slate-500">Р—Р°РіСЂСѓР·РєР°...</p>
            <div class="flex items-center gap-1">
              <button id="prevPageBtn" class="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-400 hover:bg-slate-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed" disabled>
                <span class="material-symbols-outlined text-lg">chevron_left</span>
              </button>
              <span id="pageLabel" class="px-3 py-1.5 text-sm font-semibold text-slate-600">1</span>
              <button id="nextPageBtn" class="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-400 hover:bg-slate-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                <span class="material-symbols-outlined text-lg">chevron_right</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </main>
  </div>

  <div id="passwordModal" hidden class="fixed inset-0 z-50 flex items-center justify-center p-4">
    <div class="absolute inset-0 bg-slate-900/40" data-close-password-modal></div>
    <div class="relative w-full max-w-md rounded-2xl bg-white border border-slate-200 shadow-2xl p-5">
      <div class="flex items-start justify-between gap-3 mb-4">
        <div>
          <h4 class="text-lg font-bold">РЎРјРµРЅР° РїР°СЂРѕР»СЏ</h4>
          <p id="passwordModalSubtitle" class="text-sm text-slate-500 mt-1"></p>
        </div>
        <button type="button" class="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500" data-close-password-modal>
          <span class="material-symbols-outlined text-[20px]">close</span>
        </button>
      </div>
      <form id="passwordForm" class="space-y-4">
        <div>
          <label for="newPasswordInput" class="block text-sm font-semibold text-slate-700 mb-1.5">РќРѕРІС‹Р№ РїР°СЂРѕР»СЊ</label>
          <input id="newPasswordInput" type="password" minlength="8" maxlength="128" required class="w-full rounded-xl border-slate-200 bg-slate-50 p-3 text-sm focus:ring-2 focus:ring-primary/40 focus:border-primary" placeholder="РњРёРЅРёРјСѓРј 8 СЃРёРјРІРѕР»РѕРІ" />
        </div>
        <div id="passwordFormError" class="hidden text-sm text-red-600"></div>
        <div class="flex items-center justify-end gap-2">
          <button type="button" class="px-4 py-2 rounded-xl border border-slate-200 bg-white text-sm font-semibold hover:bg-slate-50" data-close-password-modal>РћС‚РјРµРЅР°</button>
          <button id="savePasswordBtn" type="submit" class="px-4 py-2 rounded-xl bg-primary text-white text-sm font-semibold hover:bg-primary/90">РЎРѕС…СЂР°РЅРёС‚СЊ</button>
        </div>
      </form>
    </div>
  </div>

  <div id="tariffModal" hidden class="fixed inset-0 z-50 flex items-center justify-center p-4">
    <div class="absolute inset-0 bg-slate-900/40" data-close-tariff-modal></div>
    <div class="relative w-full max-w-md rounded-2xl bg-white border border-slate-200 shadow-2xl p-5">
      <div class="flex items-start justify-between gap-3 mb-4">
        <div>
          <h4 class="text-lg font-bold">РЎРјРµРЅР° С‚Р°СЂРёС„Р°</h4>
          <p id="tariffModalSubtitle" class="text-sm text-slate-500 mt-1"></p>
        </div>
        <button type="button" class="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500" data-close-tariff-modal>
          <span class="material-symbols-outlined text-[20px]">close</span>
        </button>
      </div>
      <form id="tariffForm" class="space-y-4">
        <div>
          <label for="tariffSelect" class="block text-sm font-semibold text-slate-700 mb-1.5">РўР°СЂРёС„</label>
          <select id="tariffSelect" class="w-full rounded-xl border-slate-200 bg-slate-50 p-3 text-sm focus:ring-2 focus:ring-primary/40 focus:border-primary">
            <option value="free">Free</option>
            <option value="pro">Pro</option>
            <option value="enterprise">Enterprise</option>
          </select>
        </div>
        <div id="tariffFormError" class="hidden text-sm text-red-600"></div>
        <div class="flex items-center justify-end gap-2">
          <button type="button" class="px-4 py-2 rounded-xl border border-slate-200 bg-white text-sm font-semibold hover:bg-slate-50" data-close-tariff-modal>РћС‚РјРµРЅР°</button>
          <button id="saveTariffBtn" type="submit" class="px-4 py-2 rounded-xl bg-primary text-white text-sm font-semibold hover:bg-primary/90">РЎРѕС…СЂР°РЅРёС‚СЊ</button>
        </div>
      </form>
    </div>
  </div>

  <script>
    const storageKeys = {
      session: "dialogTrainerSession",
      accessToken: "dialogTrainerAccessToken",
    };

    const state = {
      token: "",
      users: [],
      page: 1,
      pageSize: 20,
      total: null,
      hasNextPage: false,
      search: "",
      loading: false,
      actionUserId: "",
    };

    const els = {
      tableBody: document.getElementById("tableBody"),
      searchInput: document.getElementById("searchInput"),
      refreshBtn: document.getElementById("refreshBtn"),
      exportBtn: document.getElementById("exportBtn"),
      paginationMeta: document.getElementById("paginationMeta"),
      pageLabel: document.getElementById("pageLabel"),
      prevPageBtn: document.getElementById("prevPageBtn"),
      nextPageBtn: document.getElementById("nextPageBtn"),
      notice: document.getElementById("notice"),
      adminName: document.getElementById("adminName"),
      adminEmail: document.getElementById("adminEmail"),
      signOutBtn: document.getElementById("signOutBtn"),
      passwordModal: document.getElementById("passwordModal"),
      passwordModalSubtitle: document.getElementById("passwordModalSubtitle"),
      passwordForm: document.getElementById("passwordForm"),
      newPasswordInput: document.getElementById("newPasswordInput"),
      savePasswordBtn: document.getElementById("savePasswordBtn"),
      passwordFormError: document.getElementById("passwordFormError"),
      tariffModal: document.getElementById("tariffModal"),
      tariffModalSubtitle: document.getElementById("tariffModalSubtitle"),
      tariffForm: document.getElementById("tariffForm"),
      tariffSelect: document.getElementById("tariffSelect"),
      saveTariffBtn: document.getElementById("saveTariffBtn"),
      tariffFormError: document.getElementById("tariffFormError"),
    };

    function getTokenFromStorage() {
      const directToken = localStorage.getItem(storageKeys.accessToken);
      if (directToken) {
        return directToken;
      }

      const raw = localStorage.getItem(storageKeys.session);
      if (!raw) {
        return "";
      }

      try {
        const session = JSON.parse(raw);
        return String(session?.access_token || "");
      } catch (_error) {
        return "";
      }
    }

    function clearSessionAndGoToLogin() {
      localStorage.removeItem(storageKeys.accessToken);
      localStorage.removeItem(storageKeys.session);
      window.location.href = "/login";
    }

    async function apiRequest(url, options = {}) {
      const method = String(options.method || "GET").toUpperCase();
      const hasBody = options.body !== undefined;
      const headers = {
        Authorization: `Bearer ${state.token}`,
      };

      if (hasBody) {
        headers["Content-Type"] = "application/json";
      }

      const response = await fetch(url, {
        method,
        headers,
        body: hasBody ? JSON.stringify(options.body) : undefined,
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(payload.error || "Request failed.");
        error.status = response.status;
        error.payload = payload;
        throw error;
      }
      return payload;
    }

    function showNotice(message, type = "neutral") {
      if (!message) {
        els.notice.className = "hidden mb-4 rounded-xl border px-4 py-3 text-sm";
        els.notice.textContent = "";
        return;
      }

      const palette =
        type === "error"
          ? "mb-4 rounded-xl border px-4 py-3 text-sm border-red-200 bg-red-50 text-red-700"
          : type === "warn"
            ? "mb-4 rounded-xl border px-4 py-3 text-sm border-amber-200 bg-amber-50 text-amber-700"
            : "mb-4 rounded-xl border px-4 py-3 text-sm border-slate-200 bg-slate-50 text-slate-700";

      els.notice.className = palette;
      els.notice.textContent = message;
    }

    function getInitials(fullName, email) {
      const source = String(fullName || "").trim() || String(email || "").trim();
      const tokens = source.split(/[\s@._-]+/).filter(Boolean).slice(0, 2);
      const letters = tokens.map((part) => part[0]).join("").slice(0, 2).toUpperCase();
      return letters || "U";
    }

    function formatDate(value) {
      if (!value) {
        return "вЂ”";
      }

      const date = new Date(value);
      if (Number.isNaN(date.getTime())) {
        return "вЂ”";
      }

      return new Intl.DateTimeFormat("ru-RU", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      }).format(date);
    }

    function getPlanBadge(plan) {
      const normalized = String(plan || "free").trim().toLowerCase();
      if (normalized === "pro") {
        return '<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary">Pro</span>';
      }
      if (normalized === "enterprise") {
        return '<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">Enterprise</span>';
      }
      return '<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600">Free</span>';
    }

    function getStatusBadge(status) {
      const normalized = String(status || "").trim().toLowerCase();
      if (normalized === "active") {
        return '<div class="flex items-center gap-1.5"><span class="size-1.5 rounded-full bg-emerald-500"></span><span class="text-sm font-medium text-emerald-600">Active</span></div>';
      }
      if (normalized === "blocked") {
        return '<div class="flex items-center gap-1.5"><span class="size-1.5 rounded-full bg-red-500"></span><span class="text-sm font-medium text-red-600">Blocked</span></div>';
      }
      if (normalized === "inactive") {
        return '<div class="flex items-center gap-1.5"><span class="size-1.5 rounded-full bg-slate-400"></span><span class="text-sm font-medium text-slate-500">Inactive</span></div>';
      }
      return '<div class="flex items-center gap-1.5"><span class="size-1.5 rounded-full bg-blue-500"></span><span class="text-sm font-medium text-blue-600">Pending</span></div>';
    }

    function findUserById(userId) {
      const normalizedId = String(userId || "").trim();
      if (!normalizedId) {
        return null;
      }
      return state.users.find((user) => String(user.id || "") === normalizedId) || null;
    }

    function setInlineError(element, message) {
      if (!message) {
        element.textContent = "";
        element.classList.add("hidden");
        return;
      }
      element.textContent = message;
      element.classList.remove("hidden");
    }

    function openPasswordModal(userId) {
      const user = findUserById(userId);
      if (!user) {
        showNotice("РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ РЅРµ РЅР°Р№РґРµРЅ РІ С‚РµРєСѓС‰РµРј СЃРїРёСЃРєРµ.", "warn");
        return;
      }

      state.actionUserId = String(user.id || "");
      els.passwordModalSubtitle.textContent = `${String(user.fullName || user.email || "").trim()} (${String(user.email || "").trim()})`;
      els.newPasswordInput.value = "";
      setInlineError(els.passwordFormError, "");
      els.passwordModal.hidden = false;
      window.setTimeout(() => {
        els.newPasswordInput.focus();
      }, 50);
    }

    function closePasswordModal() {
      state.actionUserId = "";
      els.passwordModal.hidden = true;
      els.newPasswordInput.value = "";
      setInlineError(els.passwordFormError, "");
    }

    function openTariffModal(userId) {
      const user = findUserById(userId);
      if (!user) {
        showNotice("РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ РЅРµ РЅР°Р№РґРµРЅ РІ С‚РµРєСѓС‰РµРј СЃРїРёСЃРєРµ.", "warn");
        return;
      }

      state.actionUserId = String(user.id || "");
      els.tariffModalSubtitle.textContent = `${String(user.fullName || user.email || "").trim()} (${String(user.email || "").trim()})`;
      const plan = String(user.plan || "free").trim().toLowerCase();
      els.tariffSelect.value = ["free", "pro", "enterprise"].includes(plan) ? plan : "free";
      setInlineError(els.tariffFormError, "");
      els.tariffModal.hidden = false;
      window.setTimeout(() => {
        els.tariffSelect.focus();
      }, 50);
    }

    function closeTariffModal() {
      state.actionUserId = "";
      els.tariffModal.hidden = true;
      setInlineError(els.tariffFormError, "");
    }

    async function submitPasswordChange() {
      const userId = String(state.actionUserId || "").trim();
      const password = String(els.newPasswordInput.value || "");
      if (!userId) {
        setInlineError(els.passwordFormError, "РќРµ РІС‹Р±СЂР°РЅ РїРѕР»СЊР·РѕРІР°С‚РµР»СЊ.");
        return;
      }

      if (password.length < 8 || password.length > 128) {
        setInlineError(els.passwordFormError, "РџР°СЂРѕР»СЊ РґРѕР»Р¶РµРЅ СЃРѕРґРµСЂР¶Р°С‚СЊ РѕС‚ 8 РґРѕ 128 СЃРёРјРІРѕР»РѕРІ.");
        return;
      }

      els.savePasswordBtn.disabled = true;
      setInlineError(els.passwordFormError, "");

      try {
        await apiRequest(`/api/v1/admin/users/${encodeURIComponent(userId)}/password`, {
          method: "POST",
          body: {
            password,
          },
        });
        closePasswordModal();
        showNotice("РџР°СЂРѕР»СЊ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ СѓСЃРїРµС€РЅРѕ РѕР±РЅРѕРІР»С‘РЅ.");
      } catch (error) {
        if (error.status === 401) {
          clearSessionAndGoToLogin();
          return;
        }
        if (error.status === 403) {
          setInlineError(els.passwordFormError, "РќРµРґРѕСЃС‚Р°С‚РѕС‡РЅРѕ РїСЂР°РІ РґР»СЏ СЌС‚РѕР№ РѕРїРµСЂР°С†РёРё.");
          return;
        }
        setInlineError(els.passwordFormError, error.message || "РќРµ СѓРґР°Р»РѕСЃСЊ РѕР±РЅРѕРІРёС‚СЊ РїР°СЂРѕР»СЊ.");
      } finally {
        els.savePasswordBtn.disabled = false;
      }
    }

    async function submitTariffChange() {
      const userId = String(state.actionUserId || "").trim();
      const tariff = String(els.tariffSelect.value || "").trim().toLowerCase();
      if (!userId) {
        setInlineError(els.tariffFormError, "РќРµ РІС‹Р±СЂР°РЅ РїРѕР»СЊР·РѕРІР°С‚РµР»СЊ.");
        return;
      }

      if (!["free", "pro", "enterprise"].includes(tariff)) {
        setInlineError(els.tariffFormError, "Р’С‹Р±РµСЂРёС‚Рµ РєРѕСЂСЂРµРєС‚РЅС‹Р№ С‚Р°СЂРёС„.");
        return;
      }

      els.saveTariffBtn.disabled = true;
      setInlineError(els.tariffFormError, "");

      try {
        await apiRequest(`/api/v1/admin/users/${encodeURIComponent(userId)}/tariff`, {
          method: "POST",
          body: {
            tariff,
          },
        });
        closeTariffModal();
        showNotice("РўР°СЂРёС„ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ РѕР±РЅРѕРІР»С‘РЅ.");
        await loadUsers();
      } catch (error) {
        if (error.status === 401) {
          clearSessionAndGoToLogin();
          return;
        }
        if (error.status === 403) {
          setInlineError(els.tariffFormError, "РќРµРґРѕСЃС‚Р°С‚РѕС‡РЅРѕ РїСЂР°РІ РґР»СЏ СЌС‚РѕР№ РѕРїРµСЂР°С†РёРё.");
          return;
        }
        setInlineError(els.tariffFormError, error.message || "РќРµ СѓРґР°Р»РѕСЃСЊ РѕР±РЅРѕРІРёС‚СЊ С‚Р°СЂРёС„.");
      } finally {
        els.saveTariffBtn.disabled = false;
      }
    }

    async function runImpersonation(userId) {
      const user = findUserById(userId);
      if (!user) {
        showNotice("РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ РЅРµ РЅР°Р№РґРµРЅ РІ С‚РµРєСѓС‰РµРј СЃРїРёСЃРєРµ.", "warn");
        return;
      }

      const confirmed = window.confirm(
        `РћС‚РєСЂС‹С‚СЊ СЃРµСЃСЃРёСЋ РѕС‚ РёРјРµРЅРё РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ ${String(user.email || "").trim()} РІ РЅРѕРІРѕР№ РІРєР»Р°РґРєРµ?`
      );
      if (!confirmed) {
        return;
      }

      try {
        const payload = await apiRequest(`/api/v1/admin/users/${encodeURIComponent(userId)}/impersonate`, {
          method: "POST",
          body: {
            redirectTo: `${window.location.origin}/builder`,
          },
        });

        const actionLink = String(payload?.actionLink || "").trim();
        if (!actionLink) {
          showNotice("РЎСЃС‹Р»РєР° РґР»СЏ РІС…РѕРґР° РЅРµ Р±С‹Р»Р° РїРѕР»СѓС‡РµРЅР°.", "warn");
          return;
        }

        window.open(actionLink, "_blank", "noopener,noreferrer");
        showNotice("РћС‚РєСЂС‹С‚Р° РЅРѕРІР°СЏ РІРєР»Р°РґРєР° СЃ РІС…РѕРґРѕРј РїРѕРґ РІС‹Р±СЂР°РЅРЅС‹Рј РїРѕР»СЊР·РѕРІР°С‚РµР»РµРј.");
      } catch (error) {
        if (error.status === 401) {
          clearSessionAndGoToLogin();
          return;
        }
        if (error.status === 403) {
          showNotice("РќРµРґРѕСЃС‚Р°С‚РѕС‡РЅРѕ РїСЂР°РІ РґР»СЏ impersonation.", "warn");
          return;
        }
        showNotice(error.message || "РќРµ СѓРґР°Р»РѕСЃСЊ РІС‹РїРѕР»РЅРёС‚СЊ РІС…РѕРґ РїРѕРґ РїРѕР»СЊР·РѕРІР°С‚РµР»РµРј.", "error");
      }
    }

    function renderTable() {
      if (!state.users.length) {
        els.tableBody.innerHTML = `
          <tr>
            <td colspan="6" class="px-6 py-14 text-center text-slate-500">
              РџРѕР»СЊР·РѕРІР°С‚РµР»Рё РЅРµ РЅР°Р№РґРµРЅС‹.
            </td>
          </tr>
        `;
        return;
      }

      els.tableBody.innerHTML = state.users
        .map((user) => {
          const fullName = String(user.fullName || "").trim() || "Р‘РµР· РёРјРµРЅРё";
          const email = String(user.email || "").trim() || "вЂ”";
          const initials = getInitials(fullName, email);
          return `
            <tr class="hover:bg-slate-50/60 transition-colors">
              <td class="px-6 py-4">
                <div class="flex items-center gap-3">
                  <div class="size-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-xs">${initials}</div>
                  <span class="font-medium text-slate-900">${fullName}</span>
                </div>
              </td>
              <td class="px-6 py-4 text-sm text-slate-500">${email}</td>
              <td class="px-6 py-4 text-sm text-slate-500">${formatDate(user.registeredAt)}</td>
              <td class="px-6 py-4">${getPlanBadge(user.plan)}</td>
              <td class="px-6 py-4">${getStatusBadge(user.status)}</td>
              <td class="px-6 py-4 text-right">
                <div class="flex justify-end gap-2">
                  <button class="p-2 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-primary transition-colors" title="РЎРјРµРЅРёС‚СЊ РїР°СЂРѕР»СЊ" data-action="password" data-user-id="${user.id}">
                    <span class="material-symbols-outlined text-lg">key</span>
                  </button>
                  <button class="p-2 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-primary transition-colors" title="Р’РѕР№С‚Рё РєР°Рє РїРѕР»СЊР·РѕРІР°С‚РµР»СЊ" data-action="impersonate" data-user-id="${user.id}">
                    <span class="material-symbols-outlined text-lg">person_search</span>
                  </button>
                  <button class="p-2 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-primary transition-colors" title="РЎРјРµРЅРёС‚СЊ С‚Р°СЂРёС„" data-action="tariff" data-user-id="${user.id}">
                    <span class="material-symbols-outlined text-lg">workspace_premium</span>
                  </button>
                </div>
              </td>
            </tr>
          `;
        })
        .join("");
    }

    function renderPagination() {
      els.pageLabel.textContent = String(state.page);
      els.prevPageBtn.disabled = state.page <= 1 || state.loading;
      els.nextPageBtn.disabled = !state.hasNextPage || state.loading;

      if (typeof state.total === "number") {
        const start = (state.page - 1) * state.pageSize + (state.users.length ? 1 : 0);
        const end = (state.page - 1) * state.pageSize + state.users.length;
        els.paginationMeta.textContent = `РџРѕРєР°Р·Р°РЅРѕ ${start}-${end} РёР· ${state.total}`;
      } else {
        const start = (state.page - 1) * state.pageSize + (state.users.length ? 1 : 0);
        const end = (state.page - 1) * state.pageSize + state.users.length;
        els.paginationMeta.textContent = `РџРѕРєР°Р·Р°РЅРѕ ${start}-${end}`;
      }
    }

    function setLoading(nextLoading) {
      state.loading = Boolean(nextLoading);
      els.refreshBtn.disabled = state.loading;
      els.exportBtn.disabled = state.loading;
      els.prevPageBtn.disabled = state.loading || state.page <= 1;
      els.nextPageBtn.disabled = state.loading || !state.hasNextPage;
    }

    async function loadAdminProfile() {
      const payload = await apiRequest("/api/v1/auth/me");
      const fullName = String(payload?.user?.user_metadata?.full_name || "").trim() || "РђРґРјРёРЅРёСЃС‚СЂР°С‚РѕСЂ";
      const email = String(payload?.user?.email || "").trim() || "вЂ”";
      els.adminName.textContent = fullName;
      els.adminEmail.textContent = email;
    }

    async function loadUsers() {
      setLoading(true);
      showNotice("");
      try {
        const params = new URLSearchParams({
          page: String(state.page),
          pageSize: String(state.pageSize),
        });
        if (state.search) {
          params.set("search", state.search);
        }

        const payload = await apiRequest(`/api/v1/admin/users?${params.toString()}`);
        state.users = Array.isArray(payload.items) ? payload.items : [];
        state.total = typeof payload.total === "number" ? payload.total : null;
        state.hasNextPage = Boolean(payload.hasNextPage);
        renderTable();
        renderPagination();
      } catch (error) {
        state.users = [];
        state.hasNextPage = false;
        state.total = null;
        renderTable();
        renderPagination();
        if (error.status === 401) {
          clearSessionAndGoToLogin();
          return;
        }
        if (error.status === 403) {
          showNotice("Р”РѕСЃС‚СѓРї Рє Р°РґРјРёРЅ-РїР°РЅРµР»Рё Р·Р°РїСЂРµС‰С‘РЅ РґР»СЏ СЌС‚РѕРіРѕ Р°РєРєР°СѓРЅС‚Р°.", "warn");
          return;
        }
        showNotice(error.message || "РќРµ СѓРґР°Р»РѕСЃСЊ Р·Р°РіСЂСѓР·РёС‚СЊ РїРѕР»СЊР·РѕРІР°С‚РµР»РµР№.", "error");
      } finally {
        setLoading(false);
      }
    }

    function downloadCsv() {
      if (!state.users.length) {
        showNotice("РЎРїРёСЃРѕРє РїСѓСЃС‚. РЎРЅР°С‡Р°Р»Р° Р·Р°РіСЂСѓР·РёС‚Рµ РїРѕР»СЊР·РѕРІР°С‚РµР»РµР№.", "warn");
        return;
      }

      const lines = [
        ["id", "fullName", "email", "registeredAt", "plan", "status"].join(";"),
        ...state.users.map((user) =>
          [
            user.id,
            String(user.fullName || "").replaceAll(";", ","),
            String(user.email || "").replaceAll(";", ","),
            user.registeredAt || "",
            user.plan || "",
            user.status || "",
          ].join(";")
        ),
      ];

      const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "admin-users.csv";
      link.click();
      URL.revokeObjectURL(url);
    }

    function bindEvents() {
      let searchTimer = null;

      els.searchInput.addEventListener("input", () => {
        window.clearTimeout(searchTimer);
        searchTimer = window.setTimeout(() => {
          state.search = String(els.searchInput.value || "").trim();
          state.page = 1;
          loadUsers();
        }, 350);
      });

      els.refreshBtn.addEventListener("click", () => {
        loadUsers();
      });

      els.exportBtn.addEventListener("click", () => {
        downloadCsv();
      });

      els.prevPageBtn.addEventListener("click", () => {
        if (state.page <= 1) {
          return;
        }
        state.page -= 1;
        loadUsers();
      });

      els.nextPageBtn.addEventListener("click", () => {
        if (!state.hasNextPage) {
          return;
        }
        state.page += 1;
        loadUsers();
      });

      els.signOutBtn.addEventListener("click", () => {
        clearSessionAndGoToLogin();
      });

      els.passwordForm.addEventListener("submit", (event) => {
        event.preventDefault();
        submitPasswordChange();
      });

      els.tariffForm.addEventListener("submit", (event) => {
        event.preventDefault();
        submitTariffChange();
      });

      document.querySelectorAll("[data-close-password-modal]").forEach((node) => {
        node.addEventListener("click", () => {
          closePasswordModal();
        });
      });

      document.querySelectorAll("[data-close-tariff-modal]").forEach((node) => {
        node.addEventListener("click", () => {
          closeTariffModal();
        });
      });

      window.addEventListener("keydown", (event) => {
        if (event.key !== "Escape") {
          return;
        }

        if (!els.passwordModal.hidden) {
          closePasswordModal();
        }
        if (!els.tariffModal.hidden) {
          closeTariffModal();
        }
      });

      els.tableBody.addEventListener("click", (event) => {
        const button = event.target.closest("[data-action]");
        if (!button) {
          return;
        }
        const action = String(button.dataset.action || "");
        if (!action) {
          return;
        }
        const userId = String(button.dataset.userId || "").trim();
        if (!userId) {
          showNotice("РќРµ СѓРґР°Р»РѕСЃСЊ РѕРїСЂРµРґРµР»РёС‚СЊ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ.", "warn");
          return;
        }

        if (action === "password") {
          openPasswordModal(userId);
          return;
        }

        if (action === "tariff") {
          openTariffModal(userId);
          return;
        }

        if (action === "impersonate") {
          runImpersonation(userId);
        }
      });
    }

    async function bootstrap() {
      state.token = getTokenFromStorage();
      if (!state.token) {
        clearSessionAndGoToLogin();
        return;
      }

      bindEvents();

      try {
        await loadAdminProfile();
      } catch (error) {
        if (error.status === 401) {
          clearSessionAndGoToLogin();
          return;
        }
      }

      await loadUsers();
    }

    bootstrap();
  
