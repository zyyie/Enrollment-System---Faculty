// Geranova Faculty Portal (Teachers)
const FacultyApp = (() => {
  const SESSION_KEY = 'shsFaculty';

  function escHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function getUser() {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  }

  function requireAuth() {
    const user = getUser();
    if (!user) {
      window.location.href = '../login.html';
      return false;
    }
    if ((user.role || '').toLowerCase() !== 'teacher') {
      sessionStorage.removeItem(SESSION_KEY);
      window.location.href = '../login.html';
      return false;
    }
    return true;
  }

  function logout() {
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem('loginRole');
    window.location.href = '../login.html';
  }

  function formatName(user) {
    if (!user) return 'Teacher';
    return `${user.lastName || ''}, ${user.firstName || ''} ${user.middleName || ''}`.trim();
  }

  async function fetchJson(url, timeoutMs = 10000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal });
      const text = await res.text();
      if (text.trim().startsWith('<')) {
        throw new Error('Server API not found. Run: python server.py in ENROLLSYSTEM-FACULTY');
      }
      let data;
      try {
        data = JSON.parse(text);
      } catch (err) {
        throw new Error('Invalid server response. Restart the faculty server.');
      }
      if (!res.ok) {
        throw new Error(data.error || `Request failed (${res.status})`);
      }
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  async function postJson(url, body, timeoutMs = 15000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await res.text();
      if (text.trim().startsWith('<')) {
        throw new Error('Server API not found. Run: python server.py in ENROLLSYSTEM-FACULTY');
      }
      let data;
      try {
        data = JSON.parse(text);
      } catch (err) {
        throw new Error('Invalid server response.');
      }
      if (!res.ok) {
        throw new Error(data.error || `Request failed (${res.status})`);
      }
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  const FA_ICONS = {
    dashboard: 'fa-gauge-high',
    grades: 'fa-graduation-cap',
    gradebook: 'fa-clipboard-list',
    gradingSheet: 'fa-table',
    schedule: 'fa-calendar-days',
    classes: 'fa-chalkboard-user',
    attendance: 'fa-user-check',
    materials: 'fa-folder-open',
    announcements: 'fa-bullhorn',
    profile: 'fa-user',
    logout: 'fa-right-from-bracket',
  };

  function faIcon(type) {
    const cls = FA_ICONS[type];
    return cls ? `<i class="fas ${cls} admin-nav-fa"></i>` : '';
  }

  function getGradesGradeLevel() {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get('gradeLevel');
    if (fromUrl === 'Grade 11' || fromUrl === 'Grade 12') {
      sessionStorage.setItem('facultyGradesLevel', fromUrl);
      return fromUrl;
    }
    return sessionStorage.getItem('facultyGradesLevel') || 'Grade 11';
  }

  function facultyIdForApi() {
    const user = getUser();
    if (!user) return '';
    return String(user.id || user.facultyId || user.faculty_id || '').trim();
  }

  function facultyQueryParam() {
    const facultyId = facultyIdForApi();
    return facultyId ? `facultyId=${encodeURIComponent(facultyId)}` : '';
  }

  function syncGradesGradeLevelInUrl() {
    const level = getGradesGradeLevel();
    const params = new URLSearchParams(window.location.search);
    if (params.get('gradeLevel') !== level) {
      params.set('gradeLevel', level);
      const next = `${window.location.pathname}?${params.toString()}`;
      window.history.replaceState({}, '', next);
    }
    return level;
  }

  function inferTeacherStrandsFromId(facultyId) {
    const text = String(facultyId || '').toUpperCase();
    const codes = [];
    if (text.includes('ICT')) codes.push('ICT');
    if (text.includes('STEM')) codes.push('STEM');
    if (text.includes('ABM')) codes.push('ABM');
    if (text.includes('HUM')) codes.push('HUMSS');
    if (text.includes('CK') || text.includes('COOKERY')) codes.push('COOKERY');
    if (text.includes('EIM')) codes.push('EIM');
    return codes;
  }

  function normalizeGradesStudentRows(res) {
    if (Array.isArray(res)) return res;
    if (Array.isArray(res?.data)) return res.data;
    if (Array.isArray(res?.students)) return res.students;
    return [];
  }

  async function fetchGradesStudents() {
    const gradeLevel = syncGradesGradeLevelInUrl();
    const facultyId = facultyIdForApi().toUpperCase();

    async function requestRows(includeFaculty = true) {
      const params = new URLSearchParams({
        gradeLevel,
        _ts: String(Date.now()),
      });
      if (includeFaculty && facultyId) params.set('facultyId', facultyId);
      const res = await fetchJson('/api/grades/students?' + params.toString());
      if (res && res.success === false) {
        throw new Error(res.error || 'Unable to load students.');
      }
      return normalizeGradesStudentRows(res);
    }

    let rows = await requestRows(true);
    if (!rows.length) {
      rows = await requestRows(false);
      const strands = inferTeacherStrandsFromId(facultyId);
      if (strands.length) {
        rows = rows.filter((student) => strands.includes(String(student.strand || '').toUpperCase()));
      }
    }
    return rows;
  }

  async function fetchGradesSections() {
    const gradeLevel = syncGradesGradeLevelInUrl();
    const facultyId = facultyIdForApi().toUpperCase();
    if (!facultyId) {
      throw new Error('Teacher session expired. Please log in again.');
    }
    const params = new URLSearchParams({
      facultyId,
      gradeLevel,
      _ts: String(Date.now()),
    });
    const res = await fetchJson('/api/grades/sections?' + params.toString());
    if (res && res.success === false) {
      throw new Error(res.error || 'Unable to load sections.');
    }
    if (Array.isArray(res)) return res;
    if (Array.isArray(res?.data)) return res.data;
    return [];
  }

  function renderGradesStudentList(containerId, students, scheduleId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (!students || !students.length) {
      container.innerHTML = '<div class="admin-empty">No enrolled students in this class.</div>';
      return;
    }

    container.innerHTML = `
      <ol class="faculty-student-name-list">
        ${students.map((student) => `
          <li class="faculty-student-name-item"
            data-id="${escHtml(student.enrollmentId)}"
            data-name="${escHtml(student.student)}"
            data-schedule-id="${escHtml(scheduleId || '')}"
            tabindex="0"
            role="button">
            ${escHtml(student.student)}
          </li>
        `).join('')}
      </ol>`;

    container.querySelectorAll('.faculty-student-name-item').forEach((item) => {
      const select = () => {
        container.querySelectorAll('.faculty-student-name-item.is-selected').forEach((el) => {
          el.classList.remove('is-selected');
        });
        item.classList.add('is-selected');
        container.dispatchEvent(new CustomEvent('grades:select-student', {
          detail: {
            enrollmentId: item.dataset.id,
            studentName: item.dataset.name,
            scheduleId: item.dataset.scheduleId || null,
          },
        }));
      };
      item.addEventListener('click', select);
      item.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          select();
        }
      });
    });
  }

  function renderGradesSectionCards(sections, selectedCardId) {
    const wrap = document.getElementById('gradesSectionsGrid');
    if (!wrap) return;

    if (!sections.length) {
      wrap.innerHTML = `<div class="admin-empty">No classes found for ${escHtml(getGradesGradeLevel())}.</div>`;
      return;
    }

    wrap.innerHTML = sections.map((section) => {
      const cardId = section.cardId || section.scheduleId || section.sectionId;
      const isActive = String(cardId) === String(selectedCardId) ? ' is-active' : '';
      const subjectCode = section.subjectCode || '';
      const subjectName = section.subjectName || (section.subjects && section.subjects[0]) || 'Subject';
      const sectionLabel = section.sectionLabel || section.sectionName || 'Section';
      const virtueName = section.sectionName || sectionLabel;
      const scheduleLabel = section.scheduleLabel || '';
      const semesterName = section.semesterName || '';
      return `
        <button type="button"
          class="faculty-section-card faculty-class-card${isActive}"
          data-card-id="${escHtml(cardId)}"
          aria-pressed="${String(cardId) === String(selectedCardId) ? 'true' : 'false'}">
          <span class="faculty-class-card-top">
            ${subjectCode ? `<span class="faculty-class-card-code">${escHtml(subjectCode)}</span>` : ''}
            <span class="faculty-class-card-section-pill">${escHtml(virtueName)}</span>
            ${semesterName ? `<span class="faculty-class-card-sem-pill">${escHtml(semesterName)}</span>` : ''}
          </span>
          <span class="faculty-class-card-subject">${escHtml(subjectName)}</span>
          <span class="faculty-class-card-meta">${escHtml(sectionLabel)}${scheduleLabel ? ` · ${escHtml(scheduleLabel)}` : ''}</span>
          <span class="faculty-class-card-foot">
            <span class="faculty-class-card-teacher">${escHtml(section.teacherName || '')}</span>
            <span class="faculty-class-card-count">${escHtml(section.studentCount || 0)} student(s)</span>
          </span>
        </button>`;
    }).join('');

    wrap.querySelectorAll('.faculty-class-card').forEach((btn) => {
      btn.addEventListener('click', () => {
        wrap.dispatchEvent(new CustomEvent('grades:select-section', {
          detail: { cardId: btn.dataset.cardId },
        }));
      });
    });
  }

  async function loadGradesSections(sectionCardsId, studentsListId) {
    const cardsWrap = document.getElementById(sectionCardsId);
    const studentsWrap = document.getElementById(studentsListId);
    const studentsPanel = document.getElementById('gradesStudentsPanel');
    if (cardsWrap) {
      cardsWrap.innerHTML = '<div class="admin-empty">Loading sections...</div>';
    }
    if (studentsWrap) {
      studentsWrap.innerHTML = '';
    }
    if (studentsPanel) {
      studentsPanel.hidden = true;
    }

    try {
      const sections = await fetchGradesSections();
      if (!sections.length) {
        if (cardsWrap) {
          cardsWrap.innerHTML = `<div class="admin-empty">No sections found for ${escHtml(getGradesGradeLevel())}.</div>`;
        }
        return { sections: [], selected: null };
      }

      renderGradesSectionCards(sections, null);

      const title = document.getElementById('gradesSectionTitle');

      function showSectionStudents(section) {
        if (!section) return;
        const cardId = section.cardId || section.scheduleId || section.sectionId;
        renderGradesSectionCards(sections, cardId);
        if (studentsPanel) {
          studentsPanel.hidden = false;
        }
        if (title) {
          const subjectName = section.subjectName || (section.subjects && section.subjects[0]) || 'Class';
          const virtue = section.sectionName || '';
          title.textContent = `Students — ${subjectName}${virtue ? ` (${virtue})` : ''}`;
        }
        renderGradesStudentList(
          studentsListId,
          section.students || [],
          section.scheduleId || section.cardId || null,
        );
      }

      if (cardsWrap) {
        cardsWrap.addEventListener('grades:select-section', (event) => {
          const cardId = event.detail.cardId;
          const section = sections.find((item) => {
            const id = item.cardId || item.scheduleId || item.sectionId;
            return String(id) === String(cardId);
          });
          if (!section) return;
          showSectionStudents(section);
        });
      }

      return { sections, selected: null };
    } catch (err) {
      if (cardsWrap) cardsWrap.innerHTML = `<div class="admin-empty">${escHtml(err.message)}</div>`;
      if (studentsWrap) studentsWrap.innerHTML = '';
      if (studentsPanel) studentsPanel.hidden = true;
      return { sections: [], selected: null };
    }
  }

  async function loadGradesStudents(containerId) {
    return loadGradesSections('gradesSectionsGrid', containerId);
  }

  function initGradesPage({ onSelectStudent } = {}) {
    if (!requireAuth()) return;
    const gradeLevel = syncGradesGradeLevelInUrl();
    initLayout('grades', `Grades Management — ${gradeLevel}`);
    const label = document.getElementById('gradesLevelLabel');
    if (label) label.textContent = gradeLevel;

    const container = document.getElementById('studentsList');
    if (container && onSelectStudent) {
      container.addEventListener('grades:select-student', (event) => {
        onSelectStudent(
          event.detail.enrollmentId,
          event.detail.studentName,
          event.detail.scheduleId || null,
        );
      });
    }

    return loadGradesSections('gradesSectionsGrid', 'studentsList');
  }

  function renderGradesNavItem(activePage) {
    const isGradesPage = activePage === 'grades';
    const selectedLevel = isGradesPage ? getGradesGradeLevel() : null;
    const isOpen = isGradesPage ? ' is-open' : '';

    const subLink = (level) => {
      const href = `grades.html?gradeLevel=${encodeURIComponent(level)}`;
      const active = isGradesPage && selectedLevel === level ? ' active' : '';
      return `<a href="${href}" class="admin-nav-sublink${active}" data-grade-level="${level}">${level}</a>`;
    };

    return `
      <div class="admin-nav-group${isOpen}">
        <button type="button" class="admin-nav-link admin-nav-toggle${isGradesPage ? ' active' : ''}" aria-expanded="${isGradesPage ? 'true' : 'false'}">
          ${faIcon('gradebook')} Gradebook
          <i class="fas fa-chevron-down admin-nav-caret" aria-hidden="true"></i>
        </button>
        <div class="admin-nav-submenu">
          ${subLink('Grade 11')}
          ${subLink('Grade 12')}
        </div>
      </div>`;
  }

  function getClassesGradeLevel() {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get('gradeLevel');
    if (fromUrl === 'Grade 11' || fromUrl === 'Grade 12') {
      sessionStorage.setItem('facultyClassesLevel', fromUrl);
      return fromUrl;
    }
    return sessionStorage.getItem('facultyClassesLevel') || 'Grade 11';
  }

  function renderClassesNavItem(activePage) {
    const isClassesPage = activePage === 'classes';
    const selectedLevel = isClassesPage ? getClassesGradeLevel() : null;
    const isOpen = isClassesPage ? ' is-open' : '';

    const subLink = (level) => {
      const href = `classes.html?gradeLevel=${encodeURIComponent(level)}`;
      const active = isClassesPage && selectedLevel === level ? ' active' : '';
      return `<a href="${href}" class="admin-nav-sublink${active}" data-classes-level="${level}">${level}</a>`;
    };

    return `
      <div class="admin-nav-group${isOpen}">
        <button type="button" class="admin-nav-link admin-nav-toggle${isClassesPage ? ' active' : ''}" aria-expanded="${isClassesPage ? 'true' : 'false'}">
          ${faIcon('classes')} My Classes
          <i class="fas fa-chevron-down admin-nav-caret" aria-hidden="true"></i>
        </button>
        <div class="admin-nav-submenu">
          ${subLink('Grade 11')}
          ${subLink('Grade 12')}
        </div>
      </div>`;
  }

  function renderSidebarLink(item, activePage) {
    const active = item.id === activePage ? ' active' : '';
    return `
      <a href="${item.href}" class="admin-nav-link${active}">
        ${faIcon(item.icon)} ${escHtml(item.label)}
      </a>`;
  }

  function bindSidebarNav() {
    document.querySelectorAll('.admin-nav-sublink[data-grade-level]').forEach(link => {
      link.addEventListener('click', () => {
        sessionStorage.setItem('facultyGradesLevel', link.dataset.gradeLevel || 'Grade 11');
      });
    });
    document.querySelectorAll('.admin-nav-sublink[data-classes-level]').forEach(link => {
      link.addEventListener('click', () => {
        sessionStorage.setItem('facultyClassesLevel', link.dataset.classesLevel || 'Grade 11');
      });
    });
    document.querySelectorAll('.admin-nav-group .admin-nav-toggle').forEach(btn => {
      btn.addEventListener('click', () => {
        const group = btn.closest('.admin-nav-group');
        const willOpen = !group?.classList.contains('is-open');
        document.querySelectorAll('.admin-nav-group.is-open').forEach(el => {
          if (el !== group) el.classList.remove('is-open');
        });
        group?.classList.toggle('is-open', willOpen);
        btn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
      });
    });
  }

  function renderSidebar(activePage) {
    const navLinks = [
      { id: 'attendance', label: 'Attendance', href: 'attendance.html', icon: 'attendance' },
      { id: 'materials', label: 'Materials', href: 'materials.html', icon: 'materials' },
      { id: 'announcements', label: 'Announcements', href: 'announcements.html', icon: 'announcements' },
      { id: 'schedule', label: 'My Schedule', href: 'schedule.html', icon: 'schedule' },
      { id: 'profile', label: 'Profile', href: 'profile.html', icon: 'profile' },
    ];

    const navHtml = [
      renderSidebarLink({ id: 'dashboard', label: 'Dashboard', href: 'dashboard.html', icon: 'dashboard' }, activePage),
      renderClassesNavItem(activePage),
      renderGradesNavItem(activePage),
      renderSidebarLink({ id: 'grading-sheet', label: 'Grading Sheet', href: 'grading-sheet.html', icon: 'gradingSheet' }, activePage),
      ...navLinks.map((item) => renderSidebarLink(item, activePage)),
    ].join('');

    return `
      <aside class="admin-sidebar" id="facultySidebar">
        <div class="admin-brand">
          <img src="../assets/geranova-logo.png" alt="Logo">
          <span>Geranova Senior High School</span>
          <small style="display:block;font-size:11px;opacity:.85;margin-top:4px;">Faculty Portal</small>
        </div>
        <nav class="admin-nav">
          ${navHtml}
          <a href="#" class="admin-nav-link faculty-logout" onclick="FacultyApp.logout(); return false;">
            ${faIcon('logout')} Logout
          </a>
        </nav>
      </aside>`;
  }

  function renderHeaderUserBlock(user, notificationCount = 2) {
    const count = Number(notificationCount) || 0;
    const badge = count > 0
      ? `<span class="faculty-notif-badge">${escHtml(String(count))}</span>`
      : '';
    return `
      <div class="admin-header-right faculty-header-actions">
        <div class="admin-notif-wrap">
          <button type="button" class="faculty-notif-btn" id="facultyNotifBtn" aria-label="Notifications">
            <i class="fas fa-bell"></i>
            ${badge}
          </button>
          <div class="admin-notif-panel" id="facultyNotifPanel">
            <h4>Notifications</h4>
            <div class="notif-item">New announcement: School Cleanliness Drive</div>
            <div class="notif-item">Grade encoding reminder from Registrar</div>
          </div>
        </div>
        <span class="faculty-header-divider" aria-hidden="true"></span>
        <div class="faculty-header-user-wrap">
          <button type="button" class="faculty-header-user-menu" id="facultyUserMenuBtn" aria-expanded="false">
            <span class="faculty-header-user-avatar"><i class="fas fa-user"></i></span>
            <span class="faculty-header-user-info">
              <strong>${escHtml(formatName(user))}</strong>
              <small>${escHtml(user?.id || '')}</small>
            </span>
            <i class="fas fa-chevron-down faculty-header-user-caret"></i>
          </button>
          <div class="faculty-header-user-dropdown" id="facultyUserDropdown">
            <a href="profile.html" class="faculty-header-user-dropdown-link"><i class="fas fa-user"></i> Profile</a>
            <a href="#" class="faculty-header-user-dropdown-link" onclick="FacultyApp.logout(); return false;">
              <i class="fas fa-right-from-bracket"></i> Logout
            </a>
          </div>
        </div>
      </div>`;
  }

  function bindHeaderActions() {
    const notifBtn = document.getElementById('facultyNotifBtn');
    const notifPanel = document.getElementById('facultyNotifPanel');
    const userBtn = document.getElementById('facultyUserMenuBtn');
    const userDropdown = document.getElementById('facultyUserDropdown');

    if (notifBtn && notifPanel) {
      notifBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        notifPanel.classList.toggle('open');
        userDropdown?.classList.remove('open');
        userBtn?.setAttribute('aria-expanded', 'false');
      });
    }

    if (userBtn && userDropdown) {
      userBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        const willOpen = !userDropdown.classList.contains('open');
        userDropdown.classList.toggle('open', willOpen);
        userBtn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
        notifPanel?.classList.remove('open');
      });
    }

    document.addEventListener('click', () => {
      notifPanel?.classList.remove('open');
      userDropdown?.classList.remove('open');
      userBtn?.setAttribute('aria-expanded', 'false');
    });
  }

  function renderHeader(pageTitle, options = {}) {
    const user = getUser();
    if (options.variant === 'schedule') {
      const subtitle = options.subtitle || '2025–2026';
      return `
        <header class="admin-header admin-header--schedule">
          <button type="button" class="admin-menu-btn" onclick="FacultyApp.toggleSidebar()" aria-label="Menu">
            <i class="fas fa-bars"></i>
          </button>
          <div class="admin-header-left">
            <h1 class="admin-page-title admin-page-title--left">${escHtml(pageTitle)}</h1>
            <p class="admin-header-subtitle">Academic Year ${escHtml(subtitle)}</p>
          </div>
          <div class="faculty-header-profile-card">
            <div class="faculty-header-profile-avatar"><i class="fas fa-user-tie"></i></div>
            <div>
              <strong>${escHtml(formatName(user))}</strong>
              <span>${escHtml(user?.id || '')}</span>
            </div>
          </div>
        </header>`;
    }

    if (options.variant === 'dashboard') {
      return `
        <header class="admin-header admin-header--dashboard">
          <button type="button" class="admin-menu-btn" onclick="FacultyApp.toggleSidebar()" aria-label="Menu">
            <i class="fas fa-bars"></i>
          </button>
          ${renderHeaderUserBlock(user, options.notificationCount ?? 2)}
        </header>`;
    }

    return `
      <header class="admin-header">
        <button type="button" class="admin-menu-btn" onclick="FacultyApp.toggleSidebar()" aria-label="Menu">
          <i class="fas fa-bars"></i>
        </button>
        <h1 class="admin-page-title">${escHtml(pageTitle)}</h1>
        <div class="admin-header-user">
          <span>${escHtml(formatName(user))}</span>
          <small>${escHtml(user?.id || '')}</small>
        </div>
      </header>`;
  }

  function initLayout(activePage, pageTitle, headerOptions = {}) {
    if (!requireAuth()) return null;
    const sidebarWrap = document.getElementById('facultySidebarWrap');
    const headerWrap = document.getElementById('facultyHeader');
    if (sidebarWrap) sidebarWrap.innerHTML = renderSidebar(activePage);
    if (headerWrap) headerWrap.innerHTML = renderHeader(pageTitle, headerOptions);
    bindSidebarNav();
    bindHeaderActions();
    return getUser();
  }

  function toggleSidebar() {
    document.getElementById('facultySidebar')?.classList.toggle('open');
  }

  function ensureMessageModalRoot() {
    let root = document.getElementById('facultyMessageModalRoot');
    if (root) return root;

    root = document.createElement('div');
    root.id = 'facultyMessageModalRoot';
    root.innerHTML = `
      <div class="admin-modal-overlay faculty-message-overlay" id="facultyMessageModalOverlay" aria-hidden="true">
        <div class="admin-modal faculty-message-modal" role="dialog" aria-modal="true" aria-labelledby="facultyMessageModalTitle">
          <div class="admin-modal-body" id="facultyMessageModalBody"></div>
          <div class="admin-modal-actions" id="facultyMessageModalActions"></div>
        </div>
      </div>`;
    document.body.appendChild(root);

    root.querySelector('#facultyMessageModalOverlay').addEventListener('click', (event) => {
      if (event.target.id === 'facultyMessageModalOverlay' && root._onClose) {
        root._onClose();
      }
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && root.querySelector('#facultyMessageModalOverlay').classList.contains('open')) {
        root._onClose?.();
      }
    });

    return root;
  }

  function closeMessageModal() {
    const overlay = document.getElementById('facultyMessageModalOverlay');
    if (!overlay) return;
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden', 'true');
    const root = document.getElementById('facultyMessageModalRoot');
    if (root) root._onClose = null;
    if (!document.getElementById('gradesModal')?.classList.contains('open')) {
      document.body.classList.remove('admin-modal-open');
    }
  }

  function messageIconMeta(type) {
    if (type === 'error') {
      return { className: 'error', icon: 'fa-circle-exclamation' };
    }
    if (type === 'info') {
      return { className: 'info', icon: 'fa-circle-info' };
    }
    if (type === 'warning') {
      return { className: 'warning', icon: 'fa-triangle-exclamation' };
    }
    return { className: 'success', icon: 'fa-circle-check' };
  }

  function ensureToastContainer() {
    let container = document.getElementById('facultyToastContainer');
    if (container) return container;
    container = document.createElement('div');
    container.id = 'facultyToastContainer';
    container.className = 'faculty-toast-container';
    container.setAttribute('aria-live', 'polite');
    container.setAttribute('aria-atomic', 'true');
    document.body.appendChild(container);
    return container;
  }

  function showToast({ type = 'success', title = 'Done', message = '', duration = 3200 }) {
    const meta = messageIconMeta(type);
    const container = ensureToastContainer();
    const toast = document.createElement('div');
    toast.className = `faculty-toast faculty-toast--${type}`;
    toast.innerHTML = `
      <span class="faculty-toast-icon is-${meta.className}"><i class="fas ${meta.icon}"></i></span>
      <div class="faculty-toast-body">
        <strong>${escHtml(title)}</strong>
        ${message ? `<span>${escHtml(message)}</span>` : ''}
      </div>
      <button type="button" class="faculty-toast-close" aria-label="Dismiss">&times;</button>`;

    const dismiss = () => {
      toast.classList.remove('is-visible');
      window.setTimeout(() => toast.remove(), 240);
    };

    toast.querySelector('.faculty-toast-close').addEventListener('click', dismiss);
    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('is-visible'));
    window.setTimeout(dismiss, duration);
  }

  function alertDialog({ type = 'info', title = 'Notice', message = '' }) {
    return new Promise((resolve) => {
      const root = ensureMessageModalRoot();
      const overlay = root.querySelector('#facultyMessageModalOverlay');
      const body = root.querySelector('#facultyMessageModalBody');
      const actions = root.querySelector('#facultyMessageModalActions');
      const meta = messageIconMeta(type);

      body.innerHTML = `
        <div class="admin-modal-icon ${meta.className}">
          <i class="fas ${meta.icon}"></i>
        </div>
        <h3 id="facultyMessageModalTitle">${escHtml(title)}</h3>
        <p>${escHtml(message.replace(/<[^>]+>/g, ''))}</p>`;

      actions.innerHTML = `
        <button type="button" class="admin-modal-btn-ok" data-action="ok">OK</button>`;

      const close = () => {
        closeMessageModal();
        resolve();
      };

      root._onClose = close;
      actions.querySelector('[data-action="ok"]').addEventListener('click', close);

      overlay.classList.add('open');
      overlay.setAttribute('aria-hidden', 'false');
      document.body.classList.add('admin-modal-open');
    });
  }

  async function showMessage({ type = 'success', title = 'Done', message = '' }) {
    if (type === 'success') {
      showToast({ type, title, message });
      return;
    }
    await alertDialog({ type, title, message });
  }

  const SCHEDULE_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const SCHEDULE_DAY_MAP = {
    mon: 'Monday', monday: 'Monday',
    tue: 'Tuesday', tues: 'Tuesday', tuesday: 'Tuesday',
    wed: 'Wednesday', wednesday: 'Wednesday',
    thu: 'Thursday', thur: 'Thursday', thurs: 'Thursday', thursday: 'Thursday',
    fri: 'Friday', friday: 'Friday',
    sat: 'Saturday', saturday: 'Saturday',
  };
  const SUBJECT_COLORS = [
    { bg: '#dbeafe', border: '#3b82f6', text: '#1e40af', dot: '#3b82f6' },
    { bg: '#dcfce7', border: '#22c55e', text: '#166534', dot: '#22c55e' },
    { bg: '#f3e8ff', border: '#a855f7', text: '#6b21a8', dot: '#a855f7' },
    { bg: '#fef3c7', border: '#f59e0b', text: '#92400e', dot: '#f59e0b' },
    { bg: '#ffe4e6', border: '#f43f5e', text: '#9f1239', dot: '#f43f5e' },
    { bg: '#cffafe', border: '#06b6d4', text: '#155e75', dot: '#06b6d4' },
  ];

  function scheduleTimeToMinutes(value) {
    if (!value) return null;
    const parts = String(value).slice(0, 5).split(':');
    const h = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    if (Number.isNaN(h) || Number.isNaN(m)) return null;
    return h * 60 + m;
  }

  function scheduleFormatTime(value) {
    if (!value) return '—';
    return String(value).slice(0, 5);
  }

  function scheduleFormatHours(minutes) {
    const hrs = minutes / 60;
    return Number.isInteger(hrs) ? String(hrs) : hrs.toFixed(1);
  }

  function scheduleNormalizeDay(value) {
    if (!value) return '';
    const key = String(value).trim().toLowerCase();
    return SCHEDULE_DAY_MAP[key] || '';
  }

  function scheduleParseDays(dayOfWeek) {
    if (!dayOfWeek) return [];
    return dayOfWeek
      .split(',')
      .map((part) => scheduleNormalizeDay(part.trim()))
      .filter(Boolean);
  }

  function scheduleInferGrade(row) {
    const sectionLevel = String(row.sectionGradeLevel || '').trim();
    if (sectionLevel === 'Grade 11' || sectionLevel === 'Grade 12') return sectionLevel;

    const section = String(row.section || '');
    if (/\b12[\s-]/.test(section) || /\s12\b/.test(section)) return 'Grade 12';
    if (/\b11[\s-]/.test(section) || /\s11\b/.test(section)) return 'Grade 11';

    const subjectLevel = String(row.subjectGradeLevel || '').trim();
    if (subjectLevel === 'Grade 11' || subjectLevel === 'Grade 12') return subjectLevel;

    const code = String(row.subjectCode || '').toUpperCase();
    if (/^G12[-_]/.test(code) || code.startsWith('G12')) return 'Grade 12';
    if (/^G11[-_]/.test(code) || code.startsWith('G11')) return 'Grade 11';
    return 'Other';
  }

  function scheduleSectionVirtue(section) {
    const text = String(section || '').trim();
    if (!text) return 'Section';
    const dash = text.lastIndexOf('-');
    if (dash >= 0) {
      const virtue = text.slice(dash + 1).trim();
      if (virtue) return virtue.charAt(0).toUpperCase() + virtue.slice(1).toLowerCase();
    }
    return text;
  }

  function scheduleSubjectColorMap(rows) {
    const map = new Map();
    rows.forEach((row) => {
      const key = row.subjectCode || row.subjectName || row.id;
      if (!map.has(key)) {
        map.set(key, SUBJECT_COLORS[map.size % SUBJECT_COLORS.length]);
      }
    });
    return map;
  }

  function scheduleParseLabelDuration(label) {
    if (!label) return null;
    const text = String(label);
    const match = text.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*[-–]\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
    if (!match) return null;

    const toMinutes = (hour, minute, meridiem) => {
      let h = parseInt(hour, 10);
      const m = parseInt(minute || '0', 10);
      const suffix = (meridiem || '').toLowerCase();
      if (suffix === 'pm' && h < 12) h += 12;
      if (suffix === 'am' && h === 12) h = 0;
      return h * 60 + m;
    };

    const start = toMinutes(match[1], match[2], match[3]);
    const end = toMinutes(match[4], match[5], match[6]);
    if (end > start) return end - start;
    return null;
  }

  function scheduleDurationMinutes(row) {
    const start = scheduleTimeToMinutes(row.startTime);
    const end = scheduleTimeToMinutes(row.endTime);
    if (start != null && end != null && end > start) {
      return end - start;
    }
    return scheduleParseLabelDuration(row.scheduleLabel) || 60;
  }

  function scheduleExpandEntries(rows) {
    return rows.flatMap((row) => {
      const days = scheduleParseDays(row.dayOfWeek);
      const start = scheduleTimeToMinutes(row.startTime);
      const duration = scheduleDurationMinutes(row);
      const dayList = days.length ? days : ['Monday'];
      return dayList.map((day) => ({
        ...row,
        day,
        startMinutes: start ?? 7 * 60,
        endMinutes: (start ?? 7 * 60) + duration,
        durationMinutes: duration,
      }));
    });
  }

  function scheduleUniqueSubjectCardsForDisplay(subjectCards) {
    const map = new Map();
    subjectCards.forEach((card) => {
      const key = `${card.grade}::${card.subjectCode || card.subjectName}`;
      if (!map.has(key)) {
        map.set(key, { ...card });
        return;
      }
      const existing = map.get(key);
      existing.weeklyMinutes += card.weeklyMinutes;
    });
    return [...map.values()];
  }

  function scheduleBuildSummary(rows) {
    const sections = new Set();
    const subjectCards = new Map();
    const uniqueSubjectCodes = new Set();
    const g11SubjectCodes = new Set();
    const g12SubjectCodes = new Set();
    let totalSessions = 0;
    let totalMinutes = 0;
    const gradeSections = { 'Grade 11': new Set(), 'Grade 12': new Set() };

    rows.forEach((row) => {
      const grade = scheduleInferGrade(row);
      const days = scheduleParseDays(row.dayOfWeek);
      const dayCount = days.length || 1;
      const duration = scheduleDurationMinutes(row);
      const subjectKey = row.subjectCode || row.subjectName;
      const cardKey = `${subjectKey}::${row.section || ''}`;

      uniqueSubjectCodes.add(subjectKey);
      if (grade === 'Grade 11') g11SubjectCodes.add(subjectKey);
      if (grade === 'Grade 12') g12SubjectCodes.add(subjectKey);

      if (row.section) sections.add(row.section);
      totalSessions += dayCount;
      totalMinutes += duration * dayCount;

      if (grade === 'Grade 11' || grade === 'Grade 12') {
        if (row.section) gradeSections[grade].add(row.section);
      }

      if (!subjectCards.has(cardKey)) {
        subjectCards.set(cardKey, {
          subjectCode: row.subjectCode,
          subjectName: row.subjectName,
          section: row.section,
          grade,
          weeklyMinutes: 0,
        });
      }
      subjectCards.get(cardKey).weeklyMinutes += duration * dayCount;
    });

    const displaySubjectCards = scheduleUniqueSubjectCardsForDisplay(Array.from(subjectCards.values()));

    return {
      totalSubjects: uniqueSubjectCodes.size,
      g11SubjectCount: g11SubjectCodes.size,
      g12SubjectCount: g12SubjectCodes.size,
      totalSections: sections.size,
      g11SectionCount: gradeSections['Grade 11'].size,
      g12SectionCount: gradeSections['Grade 12'].size,
      totalClasses: totalSessions,
      totalHours: totalMinutes / 60,
      subjectCards: displaySubjectCards,
    };
  }

  function scheduleMinutesToTime(minutes) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  function scheduleBuildGrid(entries) {
    const GRID_START = 7 * 60;
    const GRID_END = 18 * 60;
    let minMinutes = GRID_START;
    let maxMinutes = GRID_END;

    entries.forEach((entry) => {
      minMinutes = Math.min(minMinutes, Math.floor(entry.startMinutes / 60) * 60);
      maxMinutes = Math.max(maxMinutes, Math.ceil(entry.endMinutes / 60) * 60);
    });
    minMinutes = Math.min(minMinutes, GRID_START);
    maxMinutes = Math.max(maxMinutes, GRID_END);
    if (maxMinutes <= minMinutes) maxMinutes = minMinutes + 60;

    const slots = [];
    for (let m = minMinutes; m < maxMinutes; m += 60) {
      const end = m + 60;
      slots.push({
        startMinutes: m,
        label: `${scheduleMinutesToTime(m)} – ${scheduleMinutesToTime(end)}`,
      });
    }

    const cells = {};
    const skip = {};
    const ROW_HEIGHT = 64;

    entries.forEach((entry) => {
      const dayIdx = SCHEDULE_DAYS.indexOf(entry.day);
      if (dayIdx < 0) return;
      const slotIdx = Math.floor((entry.startMinutes - minMinutes) / 60);
      const rowspan = Math.max(1, Math.round(entry.durationMinutes / 60));
      if (slotIdx < 0 || slotIdx >= slots.length) return;
      const key = `${slotIdx}-${dayIdx}`;
      if (cells[key]) return;
      cells[key] = { entry, rowspan, blockHeight: rowspan * ROW_HEIGHT - 8 };
      for (let r = 1; r < rowspan; r += 1) {
        skip[`${slotIdx + r}-${dayIdx}`] = true;
      }
    });

    return { slots, cells, skip, minMinutes, rowHeight: ROW_HEIGHT };
  }

  function renderTeachingSchedule(containerId, rows) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const colorMap = scheduleSubjectColorMap(rows);
    const summary = scheduleBuildSummary(rows);
    const entries = scheduleExpandEntries(rows);
    const grid = scheduleBuildGrid(entries);

    const statCard = (iconClass, iconBg, title, value, detail) => `
      <div class="faculty-ts-stat-card">
        <div class="faculty-ts-stat-icon" style="background:${iconBg}"><i class="fas ${iconClass}"></i></div>
        <div class="faculty-ts-stat-body">
          <span class="faculty-ts-stat-label">${escHtml(title)}</span>
          <strong class="faculty-ts-stat-value">${escHtml(String(value))}</strong>
          <span class="faculty-ts-stat-detail">${detail}</span>
        </div>
      </div>`;

    const subjectCard = (card) => {
      const color = colorMap.get(card.subjectCode || card.subjectName) || SUBJECT_COLORS[0];
      const virtue = scheduleSectionVirtue(card.section);
      const sectionLine = card.section
        ? `Section: ${virtue} (${card.section})`
        : 'Section: —';
      return `
        <div class="faculty-ts-subject-item">
          <span class="faculty-ts-subject-dot" style="background:${color.dot}"></span>
          <div class="faculty-ts-subject-info">
            <strong>${escHtml(card.subjectName || card.subjectCode || 'Subject')}</strong>
            <span>${escHtml(sectionLine)}</span>
          </div>
          <span class="faculty-ts-subject-badge" style="background:${color.bg};color:${color.text}">${escHtml(scheduleFormatHours(card.weeklyMinutes))} hr / week</span>
        </div>`;
    };

    const renderGradeColumn = (grade, headerClass) => {
      const items = summary.subjectCards.filter((card) => card.grade === grade);
      return `
        <div class="faculty-ts-grade-column">
          <div class="faculty-ts-grade-head ${headerClass}">
            <i class="fas fa-graduation-cap"></i> ${escHtml(grade)} Subjects
          </div>
          <div class="faculty-ts-grade-body">
            ${items.length
              ? items.map(subjectCard).join('')
              : '<div class="faculty-ts-empty-grade">No subjects assigned.</div>'}
          </div>
        </div>`;
    };

    const legendItems = [...colorMap.entries()].map(([key, color]) => {
      const matches = rows.filter((item) => (item.subjectCode || item.subjectName) === key);
      const row = matches[0];
      const label = row?.subjectName || row?.subjectCode || key;
      const sections = [...new Set(matches.map((item) => item.section).filter(Boolean))];
      const sectionText = sections.length ? ` (${sections.join(', ')})` : '';
      return `<span class="faculty-ts-legend-item"><span class="faculty-ts-legend-dot" style="background:${color.dot}"></span>${escHtml(label)}${escHtml(sectionText)}</span>`;
    }).join('');

    const gridRows = grid.slots.map((slot, slotIdx) => {
      const dayCells = SCHEDULE_DAYS.map((day, dayIdx) => {
        const skipKey = `${slotIdx}-${dayIdx}`;
        if (grid.skip[skipKey]) return '';
        const cell = grid.cells[skipKey];
        if (cell) {
          const color = colorMap.get(cell.entry.subjectCode || cell.entry.subjectName) || SUBJECT_COLORS[0];
          const rowspan = cell.rowspan > 1 ? ` rowspan="${cell.rowspan}"` : '';
          const virtue = scheduleSectionVirtue(cell.entry.section);
          return `
            <td class="faculty-ts-grid-cell faculty-ts-grid-cell--filled"${rowspan}>
              <div class="faculty-ts-block" style="background:${color.bg};border-color:${color.border};color:${color.text};min-height:${cell.blockHeight}px">
                <strong>${escHtml(cell.entry.subjectName || cell.entry.subjectCode)}</strong>
                <span>(${escHtml(cell.entry.section || virtue)})</span>
                <span class="faculty-ts-block-room">${escHtml(cell.entry.room || 'TBA')}</span>
              </div>
            </td>`;
        }
        return '<td class="faculty-ts-grid-cell"></td>';
      }).join('');

      return `
        <tr style="height:${grid.rowHeight}px">
          <td class="faculty-ts-time-cell">${escHtml(slot.label)}</td>
          ${dayCells}
        </tr>`;
    }).join('');

    container.innerHTML = `
      <div class="faculty-ts-stats">
        ${statCard('fa-book', '#dbeafe', 'Total Subjects', summary.totalSubjects, `${summary.g11SubjectCount} in Grade 11 • ${summary.g12SubjectCount} in Grade 12`)}
        ${statCard('fa-users', '#dcfce7', 'Sections Handled', summary.totalSections, `${summary.g11SectionCount} in Grade 11 • ${summary.g12SectionCount} in Grade 12`)}
        ${statCard('fa-clock', '#f3e8ff', 'Total Classes', summary.totalClasses, 'Per Week')}
        ${statCard('fa-hourglass-half', '#fef3c7', 'Total Teaching Hours', scheduleFormatHours(summary.totalHours * 60), 'Hours Per Week')}
      </div>

      <div class="faculty-ts-grade-grid">
        ${renderGradeColumn('Grade 11', 'is-g11')}
        ${renderGradeColumn('Grade 12', 'is-g12')}
      </div>

      <div class="faculty-ts-weekly-card faculty-ts-weekly-card--primary">
        <div class="faculty-ts-weekly-head"><i class="fas fa-table"></i> Weekly Schedule</div>
        <div class="faculty-ts-grid-wrap">
          <table class="faculty-ts-grid">
            <thead>
              <tr>
                <th><i class="fas fa-clock"></i> Time</th>
                ${SCHEDULE_DAYS.map((day) => `<th>${escHtml(day.toUpperCase())}</th>`).join('')}
              </tr>
            </thead>
            <tbody>${gridRows}</tbody>
          </table>
        </div>
      </div>

      <div class="faculty-ts-footer">
        <div class="faculty-ts-legend">${legendItems || '<span class="faculty-ts-legend-item">No subjects</span>'}</div>
        <div class="faculty-ts-note">
          <i class="fas fa-lightbulb"></i>
          <div>
            <strong>Note</strong>
            <span>Schedule is subject to change. Please check regularly for updates.</span>
          </div>
        </div>
      </div>`;
  }

  async function loadTeachingSchedule(containerId, options = {}) {
    const container = document.getElementById(containerId);
    if (container) {
      container.innerHTML = '<div class="admin-empty">Loading schedule...</div>';
    }
    try {
      const q = facultyQueryParam();
      const res = await fetchJson('/api/faculty/schedule?' + q);
      const rows = res.data || [];
      if (!rows.length) {
        if (container) {
          container.innerHTML = '<div class="admin-empty">No schedule assigned yet. Contact the registrar.</div>';
        }
        return [];
      }
      renderTeachingSchedule(containerId, rows);
      return rows;
    } catch (err) {
      if (container) {
        container.innerHTML = `<div class="admin-empty">${escHtml(err.message)}</div>`;
      }
      return [];
    }
  }

  function dashboardGreetingName(user) {
    const last = String(user?.lastName || 'Teacher').trim();
    const name = last.split(/\s+/)[0] || 'Teacher';
    return `Sir ${name.charAt(0)}${name.slice(1).toLowerCase()}`;
  }

  function dashboardTodayName() {
    return new Date().toLocaleDateString('en-US', { weekday: 'long' });
  }

  function dashboardFormatNow() {
    const now = new Date();
    const date = now.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    const time = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    return { date, time };
  }

  function dashboardClassBreakdown(scheduleRows) {
    const cards = new Map();
    scheduleRows.forEach((row) => {
      const key = `${row.subjectCode || row.subjectName}::${row.section || ''}`;
      if (!cards.has(key)) {
        cards.set(key, scheduleInferGrade(row));
      }
    });
    const values = [...cards.values()];
    return {
      total: cards.size,
      g11: values.filter((g) => g === 'Grade 11').length,
      g12: values.filter((g) => g === 'Grade 12').length,
    };
  }

  function dashboardStudentBreakdown(scheduleRows, fallbackTotal = 0) {
    const sectionEnroll = new Map();
    scheduleRows.forEach((row) => {
      if (!row.section) return;
      const count = Number(row.enrolledCount) || 0;
      sectionEnroll.set(row.section, Math.max(sectionEnroll.get(row.section) || 0, count));
    });
    let g11 = 0;
    let g12 = 0;
    sectionEnroll.forEach((count, section) => {
      const grade = scheduleInferGrade({ section });
      if (grade === 'Grade 11') g11 += count;
      else if (grade === 'Grade 12') g12 += count;
    });
    const total = Math.max(g11 + g12, Number(fallbackTotal) || 0);
    if (total > 0 && g11 + g12 === 0) {
      scheduleRows.forEach((row) => {
        const count = Number(row.enrolledCount) || 0;
        if (count <= 0) return;
        const grade = scheduleInferGrade(row);
        if (grade === 'Grade 11') g11 = Math.max(g11, count);
        else if (grade === 'Grade 12') g12 = Math.max(g12, count);
      });
    }
    return { g11, g12, total: Math.max(g11 + g12, total) };
  }

  function dashboardTodaySessions(scheduleRows) {
    const today = dashboardTodayName();
    return scheduleRows
      .filter((row) => scheduleParseDays(row.dayOfWeek).includes(today))
      .sort((a, b) => (scheduleTimeToMinutes(a.startTime) || 0) - (scheduleTimeToMinutes(b.startTime) || 0));
  }

  function dashboardPendingTasks(scheduleRows) {
    const active = new Set();
    scheduleRows.forEach((row) => {
      if ((Number(row.enrolledCount) || 0) > 0) {
        active.add(`${row.subjectCode || row.subjectName}::${row.section || ''}`);
      }
    });
    return active.size;
  }

  function dashboardUniqueClasses(scheduleRows, limit = 5) {
    const seen = new Set();
    const items = [];
    scheduleRows.forEach((row) => {
      const key = `${row.subjectCode || row.subjectName}::${row.section || ''}`;
      if (seen.has(key)) return;
      seen.add(key);
      items.push(row);
    });
    return items.slice(0, limit);
  }

  function dashboardRecentActivities(scheduleRows) {
    const activities = [];
    scheduleRows.forEach((row) => {
      const count = Number(row.enrolledCount) || 0;
      if (count > 0) {
        activities.push({
          type: 'students',
          icon: 'fa-user-check',
          tone: 'green',
          text: `${count} student${count === 1 ? '' : 's'} enrolled in ${row.subjectName || row.subjectCode}`,
          meta: row.section || '',
        });
      }
    });
    if (!activities.length) {
      activities.push({
        type: 'info',
        icon: 'fa-chalkboard',
        tone: 'blue',
        text: 'Your class schedule is ready for the current term.',
        meta: 'Faculty Portal',
      });
    }
    return activities.slice(0, 4);
  }

  const DASHBOARD_ANNOUNCEMENTS = [
    {
      id: 'ann-1',
      title: 'School Cleanliness Drive',
      date: 'August 10, 2026',
      time: '10:30 AM',
      sortAt: '2026-08-10T10:30:00',
      text: 'All faculty are encouraged to remind students about proper waste disposal and classroom upkeep.',
      category: 'SCHOOL ANNOUNCEMENT',
      type: 'General',
      tone: 'blue',
      icon: 'fa-circle-info',
      audience: 'All Faculty',
      comments: 0,
      attachments: 0,
      publishedBy: 'Admin',
      publishedAt: 'Aug 10, 2026 10:30 AM',
      unread: true,
      archived: false,
    },
    {
      id: 'ann-2',
      title: 'Grade Encoding Reminder',
      date: 'August 8, 2026',
      time: '2:00 PM',
      sortAt: '2026-08-08T14:00:00',
      text: 'Please finalize first quarter grades through the Gradebook before the registrar deadline.',
      category: 'FACULTY REMINDER',
      type: 'Reminder',
      tone: 'green',
      icon: 'fa-clipboard-check',
      audience: 'All Faculty',
      comments: 0,
      attachments: 0,
      publishedBy: 'Registrar',
      publishedAt: 'Aug 8, 2026 2:00 PM',
      unread: false,
      archived: false,
    },
  ];

  const ANNOUNCEMENTS_READ_KEY = 'facultyAnnouncementsRead';

  function getAnnouncementsReadState() {
    try {
      return JSON.parse(sessionStorage.getItem(ANNOUNCEMENTS_READ_KEY) || '{}');
    } catch (err) {
      return {};
    }
  }

  function setAnnouncementRead(id) {
    const state = getAnnouncementsReadState();
    state[id] = true;
    sessionStorage.setItem(ANNOUNCEMENTS_READ_KEY, JSON.stringify(state));
  }

  function getFacultyAnnouncements() {
    const readState = getAnnouncementsReadState();
    return DASHBOARD_ANNOUNCEMENTS.map((item) => ({
      ...item,
      unread: item.unread && !readState[item.id],
    }));
  }

  function sortAnnouncements(items, sortBy) {
    const list = items.slice();
    list.sort((a, b) => {
      const aTime = new Date(a.sortAt || a.date).getTime();
      const bTime = new Date(b.sortAt || b.date).getTime();
      return sortBy === 'oldest' ? aTime - bTime : bTime - aTime;
    });
    return list;
  }

  function filterAnnouncements(items, filter) {
    if (filter === 'unread') return items.filter((item) => item.unread && !item.archived);
    if (filter === 'archived') return items.filter((item) => item.archived);
    return items.filter((item) => !item.archived);
  }

  function announcementCounts(items) {
    const all = items.filter((item) => !item.archived).length;
    const unread = items.filter((item) => item.unread && !item.archived).length;
    const archived = items.filter((item) => item.archived).length;
    return { all, unread, archived };
  }

  function renderAnnouncementCard(item) {
    const toneClass = item.tone === 'green' ? 'is-green' : 'is-blue';
    const categoryClass = item.tone === 'green' ? 'is-green' : 'is-blue';
    return `
      <article class="faculty-ann-card${item.unread ? ' is-unread' : ''}" data-id="${escHtml(item.id)}">
        <div class="faculty-ann-card-icon ${toneClass}">
          <i class="fas ${escHtml(item.icon || 'fa-circle-info')}"></i>
        </div>
        <div class="faculty-ann-card-main">
          <div class="faculty-ann-card-tags">
            <span class="faculty-ann-tag ${categoryClass}">${escHtml(item.category || 'ANNOUNCEMENT')}</span>
            <span class="faculty-ann-type">${escHtml(item.type || 'General')}</span>
          </div>
          <h3 class="faculty-ann-title">${escHtml(item.title)}</h3>
          <div class="faculty-ann-datetime">
            <span><i class="fas fa-calendar-day"></i> ${escHtml(item.date)}</span>
            <span class="faculty-ann-dot">•</span>
            <span><i class="fas fa-clock"></i> ${escHtml(item.time || '—')}</span>
          </div>
          <p class="faculty-ann-text">${escHtml(item.text)}</p>
          <div class="faculty-ann-meta">
            <span><i class="fas fa-users"></i> ${escHtml(item.audience || 'All Faculty')}</span>
            <span class="faculty-ann-meta-divider"></span>
            <span><i class="fas fa-comment"></i> ${escHtml(String(item.comments ?? 0))} Comments</span>
            <span class="faculty-ann-meta-divider"></span>
            <span><i class="fas fa-paperclip"></i> ${(item.attachments ?? 0) > 0 ? `${item.attachments} Attachment(s)` : 'No Attachments'}</span>
          </div>
        </div>
        <div class="faculty-ann-card-side">
          <button type="button" class="faculty-ann-menu-btn" aria-label="More options" title="More options">
            <i class="fas fa-ellipsis-vertical"></i>
          </button>
          <div class="faculty-ann-publisher">
            <span>Published by</span>
            <strong>${escHtml(item.publishedBy || 'Admin')}</strong>
            <small>${escHtml(item.publishedAt || item.date)}</small>
          </div>
        </div>
      </article>`;
  }

  function initAnnouncementsPage(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    let filter = 'all';
    let sortBy = 'newest';

    function paint() {
      const items = getFacultyAnnouncements();
      const counts = announcementCounts(items);
      const filtered = filterAnnouncements(items, filter);
      const sorted = sortAnnouncements(filtered, sortBy);

      container.innerHTML = `
        <div class="faculty-ann-page">
          <div class="faculty-ann-toolbar">
            <div class="faculty-ann-tabs" role="tablist">
              <button type="button" class="faculty-ann-tab${filter === 'all' ? ' is-active' : ''}" data-filter="all">
                All Announcements <span class="faculty-ann-count">${counts.all}</span>
              </button>
              <button type="button" class="faculty-ann-tab${filter === 'unread' ? ' is-active' : ''}" data-filter="unread">
                Unread <span class="faculty-ann-count">${counts.unread}</span>
              </button>
              <button type="button" class="faculty-ann-tab${filter === 'archived' ? ' is-active' : ''}" data-filter="archived">
                Archived <span class="faculty-ann-count">${counts.archived}</span>
              </button>
            </div>
            <div class="faculty-ann-toolbar-right">
              <label class="faculty-ann-sort">
                Sort by:
                <select id="annSortSelect" class="faculty-ann-sort-select">
                  <option value="newest"${sortBy === 'newest' ? ' selected' : ''}>Newest First</option>
                  <option value="oldest"${sortBy === 'oldest' ? ' selected' : ''}>Oldest First</option>
                </select>
              </label>
            </div>
          </div>
          <div class="faculty-ann-list">
            ${sorted.length
              ? sorted.map(renderAnnouncementCard).join('')
              : '<div class="faculty-ann-empty">No announcements in this view.</div>'}
          </div>
        </div>`;

      container.querySelectorAll('.faculty-ann-tab').forEach((btn) => {
        btn.addEventListener('click', () => {
          filter = btn.dataset.filter || 'all';
          paint();
        });
      });

      const sortSelect = container.querySelector('#annSortSelect');
      if (sortSelect) {
        sortSelect.addEventListener('change', () => {
          sortBy = sortSelect.value === 'oldest' ? 'oldest' : 'newest';
          paint();
        });
      }

      container.querySelectorAll('.faculty-ann-card').forEach((card) => {
        card.addEventListener('click', (event) => {
          if (event.target.closest('.faculty-ann-menu-btn')) return;
          const id = card.dataset.id;
          if (id) setAnnouncementRead(id);
          card.classList.remove('is-unread');
        });
      });

      container.querySelectorAll('.faculty-ann-menu-btn').forEach((btn) => {
        btn.addEventListener('click', (event) => {
          event.stopPropagation();
          showMessage({
            type: 'info',
            title: 'Announcement',
            message: 'Mark as read, archive, and other actions will be available in a future update.',
          });
        });
      });
    }

    paint();
  }

  function renderAnnouncementsList(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = getFacultyAnnouncements().slice(0, 2).map((item) => `
      <div class="faculty-dash-announcement">
        <span class="faculty-dash-announcement-icon"><i class="fas ${escHtml(item.icon || 'fa-circle-info')}"></i></span>
        <div class="faculty-dash-announcement-body">
          <strong>${escHtml(item.title)}</strong>
          <span class="faculty-dash-announcement-date">${escHtml(item.date)}</span>
          <p>${escHtml(item.text)}</p>
        </div>
      </div>`).join('');
  }

  function renderTeacherDashboard(containerId, dashboardData, scheduleRows, options = {}) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const user = options.user || getUser();
    const schoolName = dashboardData.schoolName || 'Geranova Senior High School';
    const classBreakdown = dashboardClassBreakdown(scheduleRows);
    const studentBreakdown = dashboardStudentBreakdown(
      scheduleRows,
      Number(dashboardData.totalStudents) || 0,
    );
    const todaySessions = dashboardTodaySessions(scheduleRows);
    const pendingTasks = dashboardPendingTasks(scheduleRows);
    const classList = dashboardUniqueClasses(scheduleRows, 5);
    const activities = dashboardRecentActivities(scheduleRows);
    const colorMap = scheduleSubjectColorMap(scheduleRows);
    const now = dashboardFormatNow();

    const statCard = (icon, iconClass, label, value, detail) => `
      <div class="faculty-dash-stat">
        <div class="faculty-dash-stat-icon ${iconClass}"><i class="fas ${icon}"></i></div>
        <div class="faculty-dash-stat-body">
          <span class="faculty-dash-stat-label">${escHtml(label)}</span>
          <strong class="faculty-dash-stat-value">${escHtml(String(value))}</strong>
          <span class="faculty-dash-stat-detail">${detail}</span>
        </div>
      </div>`;

    const todayRows = todaySessions.length
      ? todaySessions.map((row) => `
          <tr>
            <td>${escHtml(scheduleFormatTime(row.startTime))} – ${escHtml(scheduleFormatTime(row.endTime))}</td>
            <td><strong>${escHtml(row.subjectName || row.subjectCode)}</strong><span>${escHtml(row.subjectCode || '')}</span></td>
            <td>${escHtml(row.section || '—')}</td>
            <td>${escHtml(row.room || 'TBA')}</td>
            <td>${escHtml(row.scheduleLabel || 'Regular class session')}</td>
          </tr>`).join('')
      : `<tr><td colspan="5" class="faculty-dash-empty-row">No classes scheduled for today.</td></tr>`;

    const classItems = classList.length
      ? classList.map((row, idx) => {
        const color = colorMap.get(row.subjectCode || row.subjectName) || SUBJECT_COLORS[idx % SUBJECT_COLORS.length];
        const grade = scheduleInferGrade(row);
        return `
          <a href="classes.html" class="faculty-dash-class-item">
            <span class="faculty-dash-class-icon" style="background:${color.bg};color:${color.text}"><i class="fas fa-book-open"></i></span>
            <span class="faculty-dash-class-text">
              <strong>${escHtml(row.subjectName || row.subjectCode)}</strong>
              <small>${escHtml(grade)} • ${escHtml(row.section || '—')}</small>
            </span>
          </a>`;
      }).join('')
      : '<div class="faculty-dash-panel-empty">No classes assigned yet.</div>';

    const activityItems = activities.map((item) => `
      <div class="faculty-dash-activity">
        <span class="faculty-dash-activity-icon is-${item.tone}"><i class="fas ${item.icon}"></i></span>
        <div class="faculty-dash-activity-body">
          <strong>${escHtml(item.text)}</strong>
          <span>${escHtml(item.meta)}</span>
        </div>
      </div>`).join('');

    const announcementItems = DASHBOARD_ANNOUNCEMENTS.map((item) => `
      <div class="faculty-dash-announcement">
        <span class="faculty-dash-announcement-icon"><i class="fas fa-circle-info"></i></span>
        <div class="faculty-dash-announcement-body">
          <strong>${escHtml(item.title)}</strong>
          <span class="faculty-dash-announcement-date">${escHtml(item.date)}</span>
          <p>${escHtml(item.text)}</p>
        </div>
      </div>`).join('');

    container.innerHTML = `
      <div class="faculty-dash-welcome">
        <div class="faculty-dash-welcome-left">
          <div class="faculty-dash-welcome-icon"><i class="fas fa-graduation-cap"></i></div>
          <div>
            <h2 class="faculty-dash-welcome-title">Welcome, ${escHtml(dashboardGreetingName(user))}!</h2>
            <p class="faculty-dash-welcome-sub">Faculty Portal • ${escHtml(schoolName)}</p>
          </div>
        </div>
        <p class="faculty-dash-welcome-quote">"Teach with passion, inspire with purpose."</p>
        <div class="faculty-dash-welcome-meta">
          <span><i class="fas fa-calendar-day"></i> ${escHtml(now.date)}</span>
          <span><i class="fas fa-clock"></i> ${escHtml(now.time)}</span>
        </div>
      </div>

      <div class="faculty-dash-stats">
        ${statCard('fa-book-open', 'is-blue', 'My Classes', classBreakdown.total || dashboardData.classCount || 0, `${classBreakdown.g11} in Grade 11 • ${classBreakdown.g12} in Grade 12`)}
        ${statCard('fa-users', 'is-blue', 'Total Students', studentBreakdown.total, `Grade 11: ${studentBreakdown.g11} • Grade 12: ${studentBreakdown.g12}`)}
        ${statCard('fa-clipboard-list', 'is-orange', 'Pending Tasks', pendingTasks, 'To Do')}
        ${statCard('fa-calendar-check', 'is-blue', 'Classes Today', todaySessions.length, 'Scheduled')}
      </div>

      <div class="faculty-dash-card faculty-dash-today">
        <div class="faculty-dash-card-head">
          <h3><i class="fas fa-calendar-day"></i> Today's Schedule</h3>
          <span>${escHtml(now.date)}</span>
        </div>
        <div class="faculty-dash-table-wrap">
          <table class="faculty-dash-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Subject / Class</th>
                <th>Section</th>
                <th>Room</th>
                <th>Topic / Activity</th>
              </tr>
            </thead>
            <tbody>${todayRows}</tbody>
          </table>
        </div>
      </div>

      <div class="faculty-dash-grid">
        <div class="faculty-dash-card">
          <div class="faculty-dash-card-head">
            <h3><i class="fas fa-chalkboard-user"></i> My Classes</h3>
            <a href="classes.html" class="faculty-dash-link">View All</a>
          </div>
          <div class="faculty-dash-class-list">${classItems}</div>
        </div>

        <div class="faculty-dash-card">
          <div class="faculty-dash-card-head">
            <h3><i class="fas fa-clock-rotate-left"></i> Recent Activities</h3>
            <a href="grades.html" class="faculty-dash-link">View All</a>
          </div>
          <div class="faculty-dash-activity-list">${activityItems}</div>
        </div>

        <div class="faculty-dash-card">
          <div class="faculty-dash-card-head">
            <h3><i class="fas fa-bullhorn"></i> Announcements</h3>
            <a href="announcements.html" class="faculty-dash-link">View All</a>
          </div>
          <div class="faculty-dash-announcement-list">${announcementItems}</div>
        </div>
      </div>`;
  }

  async function loadTeacherDashboard(containerId, options = {}) {
    const container = document.getElementById(containerId);
    if (container) {
      container.innerHTML = '<div class="admin-empty">Loading dashboard...</div>';
    }
    try {
      const q = facultyQueryParam();
      const [dashboardRes, scheduleRes] = await Promise.all([
        fetchJson('/api/faculty/dashboard?' + q),
        fetchJson('/api/faculty/schedule?' + q),
      ]);
      const dashboardData = dashboardRes.data || {};
      let scheduleRows = scheduleRes.data || [];
      const dashClasses = dashboardData.classes || [];
      if (dashClasses.length) {
        const countById = new Map(dashClasses.map((row) => [String(row.id), row]));
        scheduleRows = scheduleRows.map((row) => {
          const fromDash = countById.get(String(row.id));
          if (!fromDash) return row;
          return {
            ...row,
            enrolledCount: Math.max(Number(row.enrolledCount) || 0, Number(fromDash.enrolledCount) || 0),
          };
        });
      }
      renderTeacherDashboard(containerId, dashboardData, scheduleRows, options);
      return { dashboardData, scheduleRows };
    } catch (err) {
      if (container) {
        container.innerHTML = `<div class="admin-empty">${escHtml(err.message)}</div>`;
      }
      return null;
    }
  }

  function filterScheduleByGrade(rows, gradeLevel) {
    if (!gradeLevel) return rows;
    return rows.filter((row) => scheduleInferGrade(row) === gradeLevel);
  }

  function formatProfileRole(role) {
    const text = String(role || 'teacher').trim();
    if (!text) return 'Teacher';
    return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
  }

  function formatProfileLastLogin(value) {
    if (!value) return '—';
    return String(value);
  }

  function initProfilePage(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const user = getUser();
    const fullName = formatName(user);
    const roleLabel = formatProfileRole(user?.role);
    const department = user?.department || '—';
    const lastLogin = formatProfileLastLogin(user?.lastLogin);

    const infoItem = (icon, label, valueHtml) => `
      <div class="faculty-profile-info-item">
        <span class="faculty-profile-info-icon"><i class="fas ${icon}"></i></span>
        <div class="faculty-profile-info-text">
          <span class="faculty-profile-info-label">${escHtml(label)}</span>
          <div class="faculty-profile-info-value">${valueHtml}</div>
        </div>
      </div>`;

    container.innerHTML = `
      <div class="faculty-profile-card">
        <aside class="faculty-profile-sidebar">
          <div class="faculty-profile-avatar"><i class="fas fa-user"></i></div>
          <h2 class="faculty-profile-name">${escHtml(fullName)}</h2>
          <span class="faculty-profile-role-badge">${escHtml(roleLabel)}</span>
        </aside>
        <section class="faculty-profile-details">
          <div class="faculty-profile-details-head">
            <i class="fas fa-id-card"></i>
            <h3>Profile Information</h3>
          </div>
          <div class="faculty-profile-info-grid">
            ${infoItem('fa-id-card', 'Faculty ID', `<strong>${escHtml(user?.id || '—')}</strong>`)}
            ${infoItem('fa-user', 'Full Name', `<strong>${escHtml(fullName)}</strong>`)}
            ${infoItem('fa-briefcase', 'Role / Position', `<strong>${escHtml(roleLabel)}</strong>`)}
            ${infoItem('fa-building', 'Department', `<strong>${escHtml(department)}</strong>`)}
            ${infoItem('fa-calendar-check', 'Last Login', `<strong>${escHtml(lastLogin)}</strong>`)}
            ${infoItem('fa-shield-halved', 'Account Status', '<span class="faculty-profile-status"><span class="faculty-profile-status-dot"></span>Active</span>')}
          </div>
          <p class="faculty-profile-note">Account changes (password, department) are managed by the registrar through the Admin Portal.</p>
        </section>
      </div>`;
  }

  async function loadAttendancePage(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '<div class="admin-empty">Loading attendance...</div>';
    try {
      const q = facultyQueryParam();
      const res = await fetchJson('/api/faculty/schedule?' + q);
      const today = dashboardTodayName();
      const todayClasses = (res.data || [])
        .filter((row) => scheduleParseDays(row.dayOfWeek).includes(today))
        .sort((a, b) => (scheduleTimeToMinutes(a.startTime) || 0) - (scheduleTimeToMinutes(b.startTime) || 0));

      if (!todayClasses.length) {
        container.innerHTML = '<div class="admin-empty">No classes scheduled for today.</div>';
        return;
      }

      container.innerHTML = `
        <table class="faculty-dash-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Subject</th>
              <th>Section</th>
              <th>Room</th>
              <th>Enrolled</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${todayClasses.map((row) => `
              <tr>
                <td>${escHtml(scheduleFormatTime(row.startTime))} – ${escHtml(scheduleFormatTime(row.endTime))}</td>
                <td><strong>${escHtml(row.subjectName || row.subjectCode)}</strong></td>
                <td>${escHtml(row.section || '—')}</td>
                <td>${escHtml(row.room || 'TBA')}</td>
                <td>${escHtml(String(row.enrolledCount ?? 0))}</td>
                <td><span class="faculty-page-badge">Ready to encode</span></td>
              </tr>`).join('')}
          </tbody>
        </table>
        <p class="faculty-page-note">Attendance encoding will be available in the next update. Review your classes scheduled for ${escHtml(today)} above.</p>`;
    } catch (err) {
      container.innerHTML = `<div class="admin-empty">${escHtml(err.message)}</div>`;
    }
  }

  return {
    escHtml,
    getUser,
    requireAuth,
    logout,
    formatName,
    fetchJson,
    postJson,
    initLayout,
    toggleSidebar,
    alertDialog,
    showMessage,
    showToast,
    facultyQueryParam,
    facultyIdForApi,
    getGradesGradeLevel,
    syncGradesGradeLevelInUrl,
    fetchGradesStudents,
    fetchGradesSections,
    loadGradesSections,
    loadGradesStudents,
    initGradesPage,
    renderTeachingSchedule,
    loadTeachingSchedule,
    renderTeacherDashboard,
    loadTeacherDashboard,
    filterScheduleByGrade,
    getClassesGradeLevel,
    getFacultyAnnouncements,
    renderAnnouncementsList,
    initAnnouncementsPage,
    initProfilePage,
    loadAttendancePage,
  };
})();

window.FacultyApp = FacultyApp;
