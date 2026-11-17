/* UI layer: forms, rendering, persistence. Depends on InvestData, InvestCalc, Charts. */
(function () {
  'use strict';
  const D = window.InvestData, C = window.InvestCalc, Ch = window.Charts;
  const STORE_KEY = 'invcalc.v1';
  const SCEN_KEY = 'invcalc.scenarios.v1';

  /* ---------- formatting ---------- */
  const nf0 = new Intl.NumberFormat('he-IL', { maximumFractionDigits: 0 });
  const nf1 = new Intl.NumberFormat('he-IL', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  const money = function (v) {
    if (!isFinite(v)) return '—';
    return (v < 0 ? '-' : '') + '₪' + nf0.format(Math.abs(Math.round(v)));
  };
  const moneyShort = function (v) {
    if (!isFinite(v)) return '—';
    const a = Math.abs(v), s = v < 0 ? '-' : '';
    if (a >= 1e6) return s + '₪' + (a / 1e6).toFixed(2).replace(/0$/, '') + 'M';
    if (a >= 1e4) return s + '₪' + Math.round(a / 1e3) + 'K';
    return money(v);
  };
  const pctf = function (v, d) { return isFinite(v) ? (d === 0 ? nf0 : nf1).format(v) + '%' : '—'; };
  const esc = function (s) { return String(s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); };
  const N = function (v) { return '<span class="num">' + esc(v) + '</span>'; };
  const $ = function (sel, root) { return (root || document).querySelector(sel); };

  /* ---------- state ---------- */
  const DEFAULT_STATE = {
    re: Object.assign({}, C.RE_DEFAULTS),
    st: Object.assign({}, C.ST_DEFAULTS),
    cmp: { amount: 500000, years: 15, autoPrice: true, fair: true, dataset: 'sp500Ils' },
    stDataset: 'sp500',
    histKey: 'sp500',
    tools: {
      mAmount: 1000000, mRate: 4.8, mYears: 25, mType: 'spitzer', mIndexed: false, mInfl: 2.5,
      ptPrice: 2500000, ptStatus: 'single',
      afEquity: 500000, afIncome: 25000, afRate: 4.8, afYears: 30, afLtv: 75, afRatio: 35,
      feAmount: 300000, feMonthly: 2000, feYears: 25, feRet: 8, feFee: 0.8,
      fiExpenses: 15000, fiWithdraw: 4, fiCurrent: 500000, fiMonthly: 5000, fiRet: 6,
      svTarget: 1000000, svYears: 15, svRet: 6, svCurrent: 100000
    },
    tab: 're'
  };
  let state = load();

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        return {
          re: Object.assign({}, DEFAULT_STATE.re, s.re), st: Object.assign({}, DEFAULT_STATE.st, s.st),
          cmp: Object.assign({}, DEFAULT_STATE.cmp, s.cmp), tools: Object.assign({}, DEFAULT_STATE.tools, s.tools),
          stDataset: s.stDataset || 'sp500', histKey: s.histKey || 'sp500', tab: s.tab || 're'
        };
      }
    } catch (e) { /* storage unavailable */ }
    return JSON.parse(JSON.stringify(DEFAULT_STATE));
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
  }

  /* ---------- history-derived presets ---------- */
  const H = D.HISTORY;
  const statsOf = function (key, fromYear) {
    const h = H[key]; const i = Math.max(0, (fromYear || h.start) - h.start);
    return C.stats(h.data.slice(i));
  };
  const lastYear = function (key) { return H[key].start + H[key].data.length - 1; };
  const housingAll = statsOf('housing'), housing15 = statsOf('housing', lastYear('housing') - 14);
  const cpiAll = statsOf('cpi');
  const spAll = statsOf('sp500'), spIls = statsOf('sp500Ils'), sp30 = statsOf('sp500', lastYear('sp500') - 29), ta = statsOf('ta125');
  const priceFromTotal = function (tot, div) { return +(((1 + tot / 100) / (1 + div / 100) - 1) * 100).toFixed(1); };

  const RE_APPR_PRESETS = [
    { label: 'ממוצע ' + H.housing.start + '–' + lastYear('housing') + ' (' + housingAll.cagr.toFixed(1) + '%)', value: +housingAll.cagr.toFixed(1) },
    { label: '15 שנים אחרונות (' + housing15.cagr.toFixed(1) + '%)', value: +housing15.cagr.toFixed(1) },
    { label: 'כמו האינפלציה (' + cpiAll.cagr.toFixed(1) + '%)', value: +cpiAll.cagr.toFixed(1) },
    { label: 'שמרני (2%)', value: 2 }
  ];
  const ST_PRESETS = [
    { label: 'S&P 500 ' + H.sp500.start + '–' + lastYear('sp500') + ' (' + spAll.cagr.toFixed(1) + '%)', price: priceFromTotal(spAll.cagr, 1.5), div: 1.5 },
    { label: 'S&P 500 – 30 שנה (' + sp30.cagr.toFixed(1) + '%)', price: priceFromTotal(sp30.cagr, 1.5), div: 1.5 },
    { label: 'S&P 500 בשקלים ' + H.sp500Ils.start + '+ (' + spIls.cagr.toFixed(1) + '%)', price: priceFromTotal(spIls.cagr, 1.5), div: 1.5 },
    { label: 'ת"א-125 ' + H.ta125.start + '+ (' + (ta.cagr + 2.5).toFixed(1) + '%)', price: +ta.cagr.toFixed(1), div: 2.5 },
    { label: 'שמרני (6%)', price: priceFromTotal(6, 2), div: 2 }
  ];

  /* ---------- field schemas ---------- */
  const RE_GROUPS = [
    { title: 'הנכס וההשקעה', open: true, fields: [
      { id: 'price', label: 'מחיר הדירה', type: 'money', help: 'מחיר הרכישה של הנכס.' },
      { id: 'equity', label: 'הון עצמי', type: 'money', help: 'הכסף שלכם. הוא מכסה את המקדמה ואת עלויות הרכישה; כל השאר ממומן במשכנתא.' },
      { id: 'buyerStatus', label: 'סוג רכישה', type: 'select', full: true, options: [['single', 'דירה יחידה'], ['additional', 'דירה נוספת (משקיע)'], ['none', 'ללא מס רכישה']],
        help: 'קובע את מדרגות מס הרכישה ואת המימון המקסימלי: 75% לדירה יחידה ו-50% לדירה להשקעה.' },
      { id: 'years', label: 'תקופת ההשקעה', type: 'years', help: 'כמה שנים תחזיקו בנכס לפני שתמכרו אותו.' },
      { id: 'appreciation', label: 'עליית ערך שנתית', type: 'pct', presets: RE_APPR_PRESETS,
        help: 'קצב עליית מחירי הדירות בשנה. הערכים המוצעים מחושבים לפי מדד מחירי הדירות של הלמ"ס.' },
      { id: 'inflation', label: 'אינפלציה שנתית', type: 'pct', help: 'משמשת להצמדה, לחישוב מס השבח הריאלי ולהצגת הערכים במונחי היום.' }
    ] },
    { title: 'עלויות רכישה', fields: [
      { id: 'purchaseTaxManual', label: 'מס רכישה (ריק = אוטומטי)', type: 'money', optional: true, full: true,
        help: 'נשאר ריק? המס מחושב לפי המדרגות (2025–2027). הזינו סכום רק אם אתם יודעים את הסכום המדויק.' },
      { id: 'lawyerPct', label: 'עו"ד (+מע"מ)', type: 'pct', help: 'שכר טרחת עורך הדין באחוזים ממחיר הדירה. בדרך כלל 0.5%–1%.' },
      { id: 'brokerBuyPct', label: 'תיווך (+מע"מ)', type: 'pct', help: 'דמי תיווך בקנייה, בדרך כלל 2%. אם לא היה מתווך, הזינו 0.' },
      { id: 'renovation', label: 'שיפוץ וריהוט', type: 'money', help: 'הוצאה חד-פעמית בתחילת ההשקעה.' },
      { id: 'otherBuyCosts', label: 'עלויות נוספות', type: 'money', help: 'שמאי, יועץ משכנתאות, פתיחת תיק ורישום.' }
    ] },
    { title: 'משכנתא', fields: [
      { id: 'mortgageRate', label: 'ריבית שנתית', type: 'pct', help: 'ריבית ממוצעת משוקללת על כל המסלולים.' },
      { id: 'mortgageYears', label: 'תקופה', type: 'years' },
      { id: 'mortgageType', label: 'לוח סילוקין', type: 'select', options: [['spitzer', 'שפיצר (החזר קבוע)'], ['equal', 'קרן שווה']],
        help: 'בשפיצר ההחזר החודשי קבוע. בקרן שווה ההחזר גבוה בהתחלה ויורד עם הזמן, וסך הריבית נמוך יותר.' },
      { id: 'indexedShare', label: 'חלק צמוד למדד', type: 'pct', help: 'איזה אחוז מהמשכנתא צמוד למדד המחירים. הקרן של החלק הזה גדלה עם האינפלציה.' }
    ] },
    { title: 'שכירות והוצאות', fields: [
      { id: 'rent', label: 'שכר דירה חודשי', type: 'money' },
      { id: 'rentGrowth', label: 'עליית שכירות בשנה', type: 'pct', help: 'בכמה עולה שכר הדירה כל שנה. בדרך כלל קרוב לאינפלציה.' },
      { id: 'vacancyMonths', label: 'חודשים ריקים בשנה', type: 'months', help: 'ממוצע החודשים בשנה שבהם הדירה עומדת ריקה, למשל בין דיירים.' },
      { id: 'maintenancePct', label: 'תחזוקה (% משכ"ד)', type: 'pct', help: 'תיקונים ובלאי. ההערכה המקובלת היא 5%–10% מהשכירות.' },
      { id: 'managementPct', label: 'ניהול נכס (% משכ"ד)', type: 'pct', help: 'אם חברת ניהול מטפלת בדירה בשבילכם, בדרך כלל 5%–8%.' },
      { id: 'insurance', label: 'ביטוח מבנה (שנתי)', type: 'money' },
      { id: 'landlordMonthly', label: 'הוצאות קבועות לחודש', type: 'money', help: 'הוצאות שאתם משלמים כבעלים, למשל ועד בית.' }
    ] },
    { title: 'מיסים, מכירה ותזרים', fields: [
      { id: 'rentTax', label: 'מס על השכירות', type: 'select', full: true,
        options: [['exempt', 'פטור (מתחת לתקרה ~₪5,654 לחודש)'], ['flat10', 'מסלול 10% מההכנסה'], ['custom', 'מס שולי על הרווח']],
        help: 'בדירות מגורים יש שלושה מסלולי מיסוי: פטור עד תקרה, 10% מההכנסה ברוטו, או מס שולי על ההכנסה אחרי הוצאות.' },
      { id: 'rentTaxCustom', label: 'שיעור מס שולי', type: 'pct' },
      { id: 'capitalGainsExempt', label: 'פטור ממס שבח במכירה', type: 'check', full: true,
        help: 'דירה יחידה פטורה בדרך כלל ממס שבח. בדירה להשקעה משלמים 25% על הרווח הריאלי.' },
      { id: 'sellBrokerPct', label: 'תיווך במכירה', type: 'pct' },
      { id: 'sellLawyerPct', label: 'עו"ד במכירה', type: 'pct' },
      { id: 'surplusRate', label: 'תשואה על עודף תזרים', type: 'pct',
        help: 'כשהשכירות גבוהה מכל ההוצאות, העודף נצבר בפיקדון או בקרן כספית בתשואה הזו.' }
    ] }
  ];

  const ST_GROUPS = [
    { title: 'סכומים וזמן', open: true, fields: [
      { id: 'initial', label: 'השקעה ראשונית', type: 'money' },
      { id: 'monthly', label: 'הפקדה חודשית', type: 'money', help: 'הוראת קבע חודשית. אפשר להשאיר 0.' },
      { id: 'contributionGrowth', label: 'עליית ההפקדה בשנה', type: 'pct', help: 'בכמה תגדל ההפקדה החודשית כל שנה, למשל בעקבות העלאה במשכורת.' },
      { id: 'years', label: 'תקופת ההשקעה', type: 'years' }
    ] },
    { title: 'תשואה צפויה', open: true, fields: [
      { id: 'priceReturn', label: 'עליית מחיר שנתית', type: 'pct', presets: ST_PRESETS,
        help: 'עליית מחיר המדד, בלי דיבידנדים. הערכים המוצעים מבוססים על ממוצע שנתי מצטבר מהשנים שבסוגריים.' },
      { id: 'dividendYield', label: 'תשואת דיבידנד', type: 'pct', help: 'ב-S&P 500 היא כיום כ-1.3%–1.5%, ובעבר הייתה כ-4%. בת"א-125 היא כ-2.5%–3%.' },
      { id: 'reinvestDividends', label: 'השקעה מחדש של הדיבידנדים', type: 'check', full: true },
      { id: 'inflation', label: 'אינפלציה שנתית', type: 'pct' }
    ] },
    { title: 'עמלות ודמי ניהול', fields: [
      { id: 'expenseRatio', label: 'דמי ניהול קרן/ETF', type: 'pct', help: 'דמי הניהול השנתיים של הקרן עצמה. בקרן מחקה זולה הם 0.03%–0.25%.' },
      { id: 'managementFee', label: 'דמי ניהול מצבירה', type: 'pct', help: 'דמי ניהול של בית ההשקעות, הבנק או קופת הגמל, באחוזים מהיתרה בכל שנה.' },
      { id: 'buyFeePct', label: 'עמלת קנייה / מהפקדה', type: 'pct', help: 'עמלת הקנייה באחוזים מכל הפקדה, או דמי ניהול מהפקדה.' }
    ] },
    { title: 'מיסוי', fields: [
      { id: 'wrapper', label: 'סוג החשבון', type: 'select', full: true,
        options: [['regular', 'חשבון מסחר רגיל'], ['hishtalmut', 'קרן השתלמות (פטור ממס)'], ['deferred', 'דחיית מס (IRA / פוליסת חיסכון)']],
        help: 'בחשבון רגיל משלמים 25% מס על כל דיבידנד ו-25% מס על הרווח במכירה. בקרן השתלמות, עד התקרה, אין מס. בדחיית מס משלמים רק בסוף.' },
      { id: 'taxRealGain', label: 'מס רק על הרווח הריאלי', type: 'check', full: true,
        help: 'בניירות ערך צמודים או שקליים מסוימים המס חל רק על הרווח שמעל האינפלציה.' }
    ] }
  ];

  const CMP_FIELDS = [
    { id: 'amount', label: 'סכום ההשקעה', type: 'money', help: 'אותו סכום מושקע בכל אחת מהאפשרויות. בנדל"ן זה ההון העצמי.' },
    { id: 'years', label: 'מספר שנים', type: 'years' },
    { id: 'autoPrice', label: 'מחיר הדירה לפי המימון המקסימלי', type: 'check', full: true,
      help: 'מחשב את מחיר הדירה הגבוה ביותר שאפשר לקנות בסכום הזה לפי מגבלת המימון של בנק ישראל. התשואה משכירות נשמרת כמו במסך הנדל"ן. אם האפשרות כבויה, משתמשים במחיר ובשכירות שבמסך הנדל"ן.' },
    { id: 'fair', label: 'השוואה הוגנת של תזרים', type: 'check', full: true,
      help: 'אם השכירות לא מכסה את המשכנתא ואתם מוסיפים כסף מהכיס, אותו סכום מושקע גם בבורסה. כך שני הצדדים מקבלים את אותו הכסף.' }
  ];

  /* ---------- form rendering ---------- */
  function parseNum(s) {
    if (s === '' || s == null) return '';
    const v = parseFloat(String(s).replace(/[^\d.\-]/g, ''));
    return isNaN(v) ? '' : v;
  }
  function displayVal(f, v) {
    if (v === '' || v == null) return '';
    if (f.type === 'money') return nf0.format(v);
    return String(v);
  }
  const UNITS = { money: '₪', pct: '%', years: 'שנ׳', months: 'חו׳' };

  function renderField(f, obj, onChange) {
    const wrap = document.createElement('div');
    wrap.className = 'field' + (f.full || f.presets || f.type === 'check' ? ' full' : '');
    if (f.type === 'check') {
      const lab = document.createElement('label'); lab.className = 'check';
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !!obj[f.id];
      cb.addEventListener('change', function () { obj[f.id] = cb.checked; onChange(); });
      lab.appendChild(cb); lab.appendChild(document.createTextNode(f.label));
      if (f.help) lab.appendChild(helpBtn(wrap));
      wrap.appendChild(lab);
    } else {
      const lab = document.createElement('label');
      const inputId = 'f_' + Math.random().toString(36).slice(2, 8);
      lab.setAttribute('for', inputId);
      lab.appendChild(document.createTextNode(f.label));
      if (f.help) lab.appendChild(helpBtn(wrap));
      wrap.appendChild(lab);
      if (f.type === 'select') {
        const sel = document.createElement('select'); sel.id = inputId;
        f.options.forEach(function (o) {
          const op = document.createElement('option'); op.value = o[0]; op.textContent = o[1];
          if (obj[f.id] === o[0]) op.selected = true; sel.appendChild(op);
        });
        sel.addEventListener('change', function () { obj[f.id] = sel.value; onChange(); });
        wrap.appendChild(sel);
      } else {
        const iw = document.createElement('div'); iw.className = 'input-wrap';
        const inp = document.createElement('input');
        inp.id = inputId; inp.type = 'text';
        inp.inputMode = f.type === 'money' ? 'numeric' : 'decimal';
        inp.autocomplete = 'off';
        inp.value = displayVal(f, obj[f.id]);
        if (f.optional) inp.placeholder = 'אוטומטי';
        inp.addEventListener('focus', function () { inp.value = obj[f.id] === '' ? '' : String(obj[f.id]); inp.select(); });
        inp.addEventListener('input', function () {
          const v = parseNum(inp.value);
          if (v === '' && !f.optional) return;
          obj[f.id] = v; onChange();
        });
        inp.addEventListener('blur', function () { inp.value = displayVal(f, obj[f.id]); });
        iw.appendChild(inp);
        const u = document.createElement('span'); u.className = 'unit'; u.textContent = UNITS[f.type] || ''; iw.appendChild(u);
        wrap.appendChild(iw);
        if (f.presets) {
          const chips = document.createElement('div'); chips.className = 'chips';
          f.presets.forEach(function (p) {
            const c = document.createElement('button'); c.type = 'button'; c.className = 'chip'; c.textContent = p.label;
            c.addEventListener('click', function () {
              if (p.value != null) obj[f.id] = p.value;
              if (p.price != null) { obj.priceReturn = p.price; obj.dividendYield = p.div; }
              onChange(true);
            });
            chips.appendChild(c);
          });
          wrap.appendChild(chips);
        }
      }
    }
    if (f.help) {
      const ht = document.createElement('div'); ht.className = 'help-text'; ht.textContent = f.help; wrap.appendChild(ht);
    }
    return wrap;
  }
  function helpBtn(wrap) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'help-btn'; b.textContent = '?';
    b.setAttribute('aria-label', 'הסבר');
    b.addEventListener('click', function (e) { e.preventDefault(); wrap.classList.toggle('show-help'); });
    return b;
  }
  function renderGroups(container, groups, obj, onChange) {
    container.textContent = '';
    groups.forEach(function (g) {
      const det = document.createElement('details'); det.className = 'card group';
      if (g.open) det.open = true;
      const sum = document.createElement('summary'); sum.textContent = g.title; det.appendChild(sum);
      const fields = document.createElement('div'); fields.className = 'fields';
      g.fields.forEach(function (f) { fields.appendChild(renderField(f, obj, onChange)); });
      det.appendChild(fields);
      container.appendChild(det);
    });
  }
  function renderFlat(container, fields, obj, onChange) {
    container.textContent = '';
    const card = document.createElement('div'); card.className = 'card card-pad';
    const fs = document.createElement('div'); fs.className = 'fields';
    fields.forEach(function (f) { fs.appendChild(renderField(f, obj, onChange)); });
    card.appendChild(fs); container.appendChild(card);
  }

  function debounce(fn, ms) {
    let t; return function () { clearTimeout(t); const a = arguments; t = setTimeout(function () { fn.apply(null, a); }, ms); };
  }

  /* ---------- result helpers ---------- */
  function kpi(label, value, sub, opts) {
    opts = opts || {};
    return '<div class="kpi' + (opts.hero ? ' hero' : '') + '"><div class="k-label">' + esc(label) + '</div>' +
      '<div class="k-value num' + (opts.neg ? ' neg' : '') + '">' + esc(value) + '</div>' +
      (sub ? '<div class="k-sub">' + sub + '</div>' : '') + '</div>';
  }
  function rows(list) {
    return '<div class="breakdown">' + list.map(function (r) {
      return '<div class="row' + (r[2] ? ' total' : '') + '"><span>' + esc(r[0]) + '</span><span class="num">' + esc(r[1]) + '</span></div>';
    }).join('') + '</div>';
  }
  function table(headers, data, rowClass) {
    let s = '<div class="table-wrap"><table class="data"><thead><tr>';
    headers.forEach(function (h, i) { s += '<th' + (i ? ' class="n"' : '') + '>' + esc(h) + '</th>'; });
    s += '</tr></thead><tbody>';
    data.forEach(function (r, k) {
      s += '<tr' + (rowClass ? ' class="' + rowClass(k) + '"' : '') + '>';
      r.forEach(function (c, i) { s += '<td' + (i ? ' class="n"' : '') + '>' + esc(c) + '</td>'; });
      s += '</tr>';
    });
    return s + '</tbody></table></div>';
  }
  function collapsible(title, inner) {
    return '<details class="card group"><summary>' + esc(title) + '</summary><div style="padding:0 14px 14px">' + inner + '</div></details>';
  }
  const COLORS = { re: 'var(--series-re)', st: 'var(--series-st)', third: 'var(--series-3)', muted: 'var(--text-3)' };

  /* ---------- REAL ESTATE view ---------- */
  function renderRE() {
    const r = C.simulateRealEstate(state.re);
    const p = r.params;
    const out = $('#re-results');
    let html = '';
    if (r.ltvWarning) {
      html += '<div class="warn">⚠️ שיעור המימון הוא ' + N(pctf(r.ltv)) + ', מעל המותר (' + r.maxLtv + '% ל' +
        (p.buyerStatus === 'single' ? 'דירה יחידה' : 'דירה נוספת') + '). כדי לעמוד במגבלה צריך להגדיל את ההון העצמי או לבחור דירה זולה יותר. ' +
        'המחיר המקסימלי עם ההון העצמי הזה: ' + N(money(C.maxPriceForEquity(p, p.equity))) + '.</div>';
    }
    if (r.outOfPocket > 0) {
      html += '<div class="warn">💸 השכירות לא מכסה את כל ההוצאות. בתקופה כולה תוסיפו מהכיס ' + N(money(r.outOfPocket)) +
        '. הסכום הזה נכלל בהשקעה הכוללת.</div>';
    }
    html += '<div class="kpis">' +
      kpi('השווי שיישאר לכם אחרי מכירה בעוד ' + p.years + ' שנים', money(r.netWorth),
        'אחרי מס שבח, עמלות מכירה ופירעון המשכנתא · ' + N(moneyShort(r.realNetWorth)) + ' במונחי היום', { hero: true }) +
      kpi('רווח נקי', money(r.profit), 'מתוך השקעה של ' + N(moneyShort(r.invested)), { neg: r.profit < 0 }) +
      kpi('תשואה שנתית (IRR)', pctf(r.irr * 100), 'פי ' + N(r.multiple.toFixed(2)) + ' על הכסף') +
      kpi('תזרים חודשי (שנה 1)', money(r.firstYearMonthlyCash), 'שכירות פחות משכנתא, הוצאות ומס', { neg: r.firstYearMonthlyCash < 0 }) +
      kpi('החזר משכנתא חודשי', money(r.firstPayment), 'הלוואה ' + N(moneyShort(r.loan)) + ' · מימון ' + N(pctf(r.ltv))) +
      kpi('תשואה ברוטו / נטו', pctf(r.grossYield) + ' / ' + pctf(r.netYield), 'שכירות שנתית חלקי מחיר') +
      kpi('ערך הנכס בסוף', moneyShort(r.finalValue), 'יתרת משכנתא ' + N(moneyShort(r.debtEnd))) +
      '</div>';

    html += '<div class="card card-pad"><h3>איך ההשקעה מתפתחת</h3><div id="re-chart"></div></div>';

    html += collapsible('פירוט עלויות הרכישה', rows([
      ['מחיר הדירה', money(p.price)],
      ['מס רכישה', money(r.purchase.purchaseTax)],
      ['עורך דין', money(r.purchase.lawyer)],
      ['תיווך', money(r.purchase.broker)],
      ['שיפוץ וריהוט', money(r.purchase.renovation)],
      ['עלויות נוספות', money(r.purchase.other)],
      ['עלות כוללת', money(r.purchase.totalCost), true],
      ['הון עצמי', money(p.equity)],
      ['משכנתא', money(r.loan), true]
    ]));
    html += collapsible('סיכום כל התקופה', rows([
      ['הכנסות משכירות', money(r.totals.rent)],
      ['הוצאות תחזוקה, ניהול וביטוח', money(-r.totals.expenses)],
      ['מס על השכירות', money(-r.totals.rentTax)],
      ['ריבית ששולמה', money(-r.totals.interest)],
      ['קרן משכנתא שהוחזרה', money(r.totals.principal)],
      ['עמלות מכירה', money(-r.sale.sellCosts)],
      ['מס שבח', money(-r.sale.tax)],
      ['עודף תזרים שנצבר', money(r.side)],
      ['כסף שהוספתם מהכיס', money(r.outOfPocket)],
      ['שווי נטו בסוף', money(r.netWorth), true]
    ]));
    html += collapsible('טבלה שנתית', table(['שנה', 'שווי נכס', 'יתרת חוב', 'שכ"ד', 'שווי נטו'],
      r.yearly.map(function (y) { return [y.year, moneyShort(y.value), moneyShort(y.debt), money(y.rent), moneyShort(y.netWorth)]; })));
    out.innerHTML = html;

    const x = [0].concat(r.yearly.map(function (y) { return y.year; }));
    const startNet = p.equity - r.purchase.buyCosts; // value if sold on day 0 roughly
    Ch.lineChart($('#re-chart'), {
      x: x, xTitle: 'שנה ', format: money, label: 'התפתחות השקעת הנדל"ן',
      series: [
        { name: 'שווי נטו (אחרי מכירה)', color: COLORS.re, values: [startNet].concat(r.yearly.map(function (y) { return y.netWorth; })) },
        { name: 'ערך הנכס', color: COLORS.third, values: [p.price].concat(r.yearly.map(function (y) { return y.value; })) },
        { name: 'יתרת משכנתא', color: COLORS.muted, dashed: true, values: [r.loan].concat(r.yearly.map(function (y) { return y.debt; })) }
      ]
    });
  }

  /* ---------- STOCKS view ---------- */
  const DATASET_OPTS = [['sp500', 'S&P 500 (1928+)'], ['sp500Ils', 'S&P 500 בשקלים (1995+)'], ['ta125', 'ת"א-125 (2008+)']];

  function renderST() {
    const r = C.simulateStocks(state.st);
    const p = r.params;
    const out = $('#st-results');
    let html = '<div class="kpis">' +
      kpi('השווי שיישאר לכם אחרי מס בעוד ' + p.years + ' שנים', money(r.netWorth),
        'אחרי דמי ניהול, עמלות ומס רווחי הון · ' + N(moneyShort(r.realNetWorth)) + ' במונחי היום', { hero: true }) +
      kpi('רווח נקי', money(r.profit), 'מתוך הפקדות של ' + N(moneyShort(r.contributed)), { neg: r.profit < 0 }) +
      kpi('תשואה שנתית נטו (IRR)', pctf(r.irr * 100), 'פי ' + N(r.multiple.toFixed(2)) + ' על הכסף') +
      kpi('דמי ניהול ועמלות', money(r.fees), 'סך הכול לאורך התקופה') +
      kpi('דיבידנדים (ברוטו)', moneyShort(r.dividendsGross), 'מס על דיבידנד: ' + N(moneyShort(r.dividendTax))) +
      kpi('מס רווחי הון במכירה', moneyShort(r.capitalGainsTax), p.wrapper === 'hishtalmut' ? 'פטור בקרן השתלמות' : '25% מהרווח') +
      '</div>';
    html += '<div class="card card-pad"><h3>צמיחת התיק</h3><div id="st-chart"></div></div>';

    html += '<div class="card card-pad"><h3>מה היה קורה בהיסטוריה?</h3>' +
      '<p class="note" style="margin-top:0">סימולציית מונטה-קרלו: 600 תרחישים שבהם כל שנה היא שנה אמיתית מההיסטוריה של המדד, בסדר אקראי. דמי הניהול, ההפקדות והמיסים הם אלה שהזנתם.</p>' +
      '<div class="tabs-inline" id="st-ds"></div><div id="st-mc"></div><div id="st-roll"></div></div>';

    html += collapsible('טבלה שנתית', table(['שנה', 'הופקד', 'שווי (לפני מס)', 'נטו אחרי מס'],
      r.yearly.map(function (y) { return [y.year, moneyShort(y.contributed), moneyShort(y.balance), moneyShort(y.netWorth)]; })));
    out.innerHTML = html;

    Ch.lineChart($('#st-chart'), {
      x: [0].concat(r.yearly.map(function (y) { return y.year; })), xTitle: 'שנה ', format: money, label: 'צמיחת התיק',
      series: [
        { name: 'שווי נטו אחרי מס', color: COLORS.st, values: [p.initial].concat(r.yearly.map(function (y) { return y.netWorth; })) },
        { name: 'סך ההפקדות', color: COLORS.muted, dashed: true, values: [p.initial].concat(r.yearly.map(function (y) { return y.contributed; })) }
      ]
    });
    renderDatasetChips($('#st-ds'), state.stDataset, function (k) { state.stDataset = k; save(); renderSTHistory(); });
    renderSTHistory();
  }

  function renderDatasetChips(container, current, onPick) {
    container.textContent = '';
    DATASET_OPTS.forEach(function (o) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'chip' + (o[0] === current ? ' on' : '');
      b.textContent = o[1];
      b.addEventListener('click', function () {
        container.querySelectorAll('.chip').forEach(function (c) { c.classList.remove('on'); });
        b.classList.add('on'); onPick(o[0]);
      });
      container.appendChild(b);
    });
  }

  function renderSTHistory() {
    const key = state.stDataset;
    const mc = C.monteCarloStocks(state.st, key, 600, 11);
    const yrs = Math.round(state.st.years);
    const el = $('#st-mc'); if (!el) return;
    el.innerHTML =
      '<div class="stat-grid">' +
      '<div><div class="s-l">תרחיש רע (10%)</div><div class="s-v num">' + esc(moneyShort(mc.p10)) + '</div></div>' +
      '<div><div class="s-l">חציון</div><div class="s-v num">' + esc(moneyShort(mc.p50)) + '</div></div>' +
      '<div><div class="s-l">תרחיש טוב (90%)</div><div class="s-v num">' + esc(moneyShort(mc.p90)) + '</div></div></div>' +
      '<p class="note">סיכוי לסיים עם פחות ממה שהפקדתם: <b class="num">' + esc(pctf(mc.lossProb)) + '</b>' +
      (key !== 'ta125' && key !== 'sp500Ils' ? ' (בדולרים, בלי שינויי שער)' : '') + '</p><div id="st-mc-chart"></div>';
    Ch.lineChart($('#st-mc-chart'), {
      x: mc.yearBands.map(function (b) { return b.year; }), xTitle: 'שנה ', format: moneyShort, height: 200, noEndDots: true,
      series: [{ name: 'חציון', color: COLORS.st, values: mc.yearBands.map(function (b) { return b.p50; }) }],
      band: { name: 'טווח 10%–90%', color: COLORS.st, lo: mc.yearBands.map(function (b) { return b.p10; }),
        hi: mc.yearBands.map(function (b) { return b.p90; }), hiName: '90%', loName: '10%' }
    });
    // rolling windows (actual consecutive periods)
    const h = H[key];
    const win = C.rollingWindows(h, yrs);
    const roll = $('#st-roll');
    if (!win.length) { roll.innerHTML = '<p class="note">אין מספיק שנות נתונים לתקופה של ' + yrs + ' שנים.</p>'; return; }
    const cag = win.map(function (w) { return w.cagr; }).sort(function (a, b) { return a - b; });
    const worst = win.reduce(function (a, b) { return b.cagr < a.cagr ? b : a; });
    const best = win.reduce(function (a, b) { return b.cagr > a.cagr ? b : a; });
    const posPct = win.filter(function (w) { return w.growth > 1; }).length / win.length * 100;
    roll.innerHTML = '<h3 style="margin-top:14px">כל התקופות של ' + yrs + ' שנים ברצף (' + esc(h.short) + ')</h3>' +
      rows([
        ['מספר תקופות שנבדקו', String(win.length)],
        ['תקופות שהסתיימו ברווח', pctf(posPct)],
        ['תשואה שנתית חציונית', pctf(C.percentile(cag, 0.5))],
        ['התקופה הגרועה ביותר (' + worst.start + '–' + worst.end + ')', pctf(worst.cagr)],
        ['התקופה הטובה ביותר (' + best.start + '–' + best.end + ')', pctf(best.cagr)]
      ]) + '<p class="note">תשואה כוללת לפני מס ודמי ניהול' + (h.approx ? ' (נתונים משוערים)' : '') + '.</p>';
  }

  /* ---------- COMPARE view ---------- */
  function cmpOpts() {
    return { amount: state.cmp.amount, years: Math.round(state.cmp.years), autoPrice: state.cmp.autoPrice, fair: state.cmp.fair };
  }
  function renderCMP() {
    const o = cmpOpts();
    const c = C.compare(state.re, state.st, o);
    const re = c.re, st = c.st;
    const out = $('#cmp-results');
    const winnerName = c.winner === 're' ? 'הנדל"ן' : 'הבורסה';
    const diffAbs = Math.abs(c.diff);
    const be = C.breakEvenAppreciation(state.re, state.st, o);
    let html = '<div class="card verdict"><div class="v-title">אחרי ' + o.years + ' שנים, לפי ההנחות שלכם</div>' +
      '<div class="v-main">' + winnerName + (c.winner === 're' ? ' מוביל' : ' מובילה') + ' ב-' + N(money(diffAbs)) + '</div>' +
      '<div class="v-sub">הפער אחרי כל המיסים והעמלות, ' + N(moneyShort(diffAbs / re.cpiFactor)) + ' במונחי היום</div></div>';

    html += '<div class="vs">' + side('re', 'נדל"ן 🏠', re.netWorth, [
      ['רווח נקי', moneyShort(re.profit)], ['תשואה שנתית', pctf(re.irr * 100)], ['השקעה כוללת', moneyShort(re.invested)],
      ['במונחי היום', moneyShort(re.realNetWorth)]]) +
      side('st', 'בורסה 📈', st.netWorth, [
        ['רווח נקי', moneyShort(st.profit)], ['תשואה שנתית', pctf(st.irr * 100)], ['השקעה כוללת', moneyShort(st.contributed)],
        ['במונחי היום', moneyShort(st.realNetWorth)]]) + '</div>';

    const rp = re.params;
    html += '<div class="card card-pad"><h3>מה בדיוק משווים</h3>' + rows([
      ['דירה במחיר', money(rp.price)], ['שכר דירה חודשי', money(rp.rent)],
      ['משכנתא', money(re.loan) + ' (' + pctf(re.ltv) + ')'], ['החזר חודשי', money(re.firstPayment)],
      ['עליית ערך הדירה בשנה', pctf(rp.appreciation)],
      ['תשואת הבורסה בשנה (מחיר + דיבידנד)', pctf(st.params.priceReturn + st.params.dividendYield)],
      ['דמי ניהול בבורסה', pctf(st.params.expenseRatio + st.params.managementFee, 1)]
    ]) + (re.outOfPocket > 0 && o.fair ? '<p class="note">במשך התקופה הוספתם לנדל"ן ' + N(money(re.outOfPocket)) +
      ' מהכיס כדי לכסות את המשכנתא. אותו סכום הושקע גם בבורסה, כדי ששני הצדדים יקבלו את אותו הכסף.</p>' : '') +
      '<div class="btn-row"><button class="btn secondary" data-goto="re">עריכת הנחות הנדל"ן</button>' +
      '<button class="btn secondary" data-goto="st">עריכת הנחות הבורסה</button></div></div>';

    html += '<div class="card card-pad"><h3>השווי נטו לאורך השנים</h3><div id="cmp-chart"></div>' +
      (isFinite(be) ? '<p class="note">🎯 <b>נקודת האיזון:</b> הנדל"ן ישתווה לבורסה אם מחירי הדירות יעלו ב-' + N(pctf(be)) +
        ' בשנה. ההנחה הנוכחית שלכם: ' + N(pctf(rp.appreciation)) + '. הממוצע ההיסטורי: ' + N(pctf(housingAll.cagr)) + '.</p>' : '') + '</div>';

    html += '<div class="card card-pad"><h3>בדיקה מול נתוני העבר</h3>' +
      '<p class="note" style="margin-top:0">כאן ההנחות הקבועות מוחלפות בשנים אמיתיות מישראל: עליית מחירי הדירות, אינפלציה ותשואת המדד באותה שנה.</p>' +
      '<div class="tabs-inline" id="cmp-ds"></div><div id="cmp-hist"></div></div>';

    html += '<button class="btn" id="share-btn" style="width:100%;margin-top:4px">📤 שיתוף התוצאה</button>';
    out.innerHTML = html;

    out.querySelectorAll('[data-goto]').forEach(function (b) { b.addEventListener('click', function () { go(b.getAttribute('data-goto')); }); });
    $('#share-btn').addEventListener('click', function () { share(c, o); });

    const yrsArr = [0].concat(re.yearly.map(function (y) { return y.year; }));
    Ch.lineChart($('#cmp-chart'), {
      x: yrsArr, xTitle: 'שנה ', format: money, label: 'השוואת נדל"ן ובורסה',
      series: [
        { name: 'נדל"ן', color: COLORS.re, values: [o.amount - re.purchase.buyCosts].concat(re.yearly.map(function (y) { return y.netWorth; })) },
        { name: 'בורסה', color: COLORS.st, values: [o.amount].concat(st.yearly.map(function (y) { return y.netWorth; })) },
        { name: 'כסף שהושקע', color: COLORS.muted, dashed: true, values: [o.amount].concat(re.yearly.map(function (y) { return y.invested; })) }
      ]
    });
    renderDatasetChips($('#cmp-ds'), state.cmp.dataset, function (k) { state.cmp.dataset = k; save(); renderCMPHistory(); });
    renderCMPHistory();
  }

  function side(cls, title, value, lines) {
    return '<div class="side ' + cls + '"><h4>' + esc(title) + '</h4><div class="big num">' + esc(moneyShort(value)) + '</div>' +
      lines.map(function (l) { return '<div class="line"><span>' + esc(l[0]) + '</span><b class="num">' + esc(l[1]) + '</b></div>'; }).join('') + '</div>';
  }

  function renderCMPHistory() {
    const o = cmpOpts();
    const key = state.cmp.dataset;
    const el = $('#cmp-hist'); if (!el) return;
    const mc = C.monteCarloCompare(state.re, state.st, o, key, 400, 5);
    const bt = C.backtestCompare(state.re, state.st, o, key);
    let html = '';
    if (!isFinite(mc.reWinPct) || mc.sampleYears === '') {
      el.innerHTML = '<p class="note">אין מספיק נתונים משותפים.</p>'; return;
    }
    html += '<h3 style="margin-top:6px">סימולציה: 400 תרחישים מהשנים ' + N(mc.sampleYears) + '</h3>' +
      '<div class="meter" role="img" aria-label="סיכוי שהנדל״ן ינצח"><div class="fill" style="width:' + mc.reWinPct.toFixed(1) + '%"></div></div>' +
      '<div class="meter-legend"><span>🏠 נדל"ן מנצח ב-' + N(pctf(mc.reWinPct, 0)) + '</span><span>📈 בורסה מנצחת ב-' + N(pctf(100 - mc.reWinPct, 0)) + '</span></div>' +
      table(['', 'רע (10%)', 'חציון', 'טוב (90%)'], [
        ['נדל"ן', moneyShort(mc.re.p10), moneyShort(mc.re.p50), moneyShort(mc.re.p90)],
        ['בורסה', moneyShort(mc.st.p10), moneyShort(mc.st.p50), moneyShort(mc.st.p90)]
      ]);
    if (bt.length) {
      const reW = bt.filter(function (b) { return b.diff >= 0; }).length;
      html += '<h3 style="margin-top:16px">לו הייתם משקיעים בשנה...</h3>' +
        '<p class="note" style="margin-top:0">התוצאה בפועל בכל תקופה רציפה של ' + o.years + ' שנים. הנדל"ן ניצח ב-' + N(reW) + ' מתוך ' + N(bt.length) + ' תקופות.</p>' +
        '<div id="bt-chart"></div>' +
        collapsible('כל התקופות בטבלה', table(['תקופה', 'נדל"ן', 'בורסה', 'מנצח'],
          bt.map(function (b) { return [b.start + '–' + b.end, moneyShort(b.re), moneyShort(b.st), b.diff >= 0 ? 'נדל"ן' : 'בורסה']; }),
          function (k) { return bt[k].diff >= 0 ? 'win-re' : 'win-st'; }));
    } else {
      html += '<p class="note">התקופה ארוכה מדי לבדיקה רציפה. הנתונים המשותפים מכסים ' + N(mc.sampleYears) + '.</p>';
    }
    html += '<p class="note">' + (key === 'sp500' ? 'S&P 500 בדולרים, בלי השפעת שער החליפין. ' : '') +
      (key === 'ta125' ? 'לת"א-125 יש נתונים רק מ-2008, ולכן המדגם קטן. ' : '') +
      'מדד מחירי הדירות מבוסס על ערכים שנתיים משוערים. ביצועי עבר אינם מבטיחים תשואה בעתיד.</p>';
    el.innerHTML = html;
    if (bt.length) {
      Ch.barChart($('#bt-chart'), {
        x: bt.map(function (b) { return b.start; }), values: bt.map(function (b) { return b.diff; }),
        posColor: COLORS.re, negColor: COLORS.st, name: 'נדל"ן פחות בורסה', format: money,
        axisFormat: function (v) { return Ch.compact(v); }, height: 180
      });
      const lg = document.createElement('div'); lg.className = 'chart-legend';
      lg.innerHTML = '<span class="key"><span class="swatch-rect" style="background:var(--series-re)"></span>מעל 0: הנדל"ן ניצח</span>' +
        '<span class="key"><span class="swatch-rect" style="background:var(--series-st)"></span>מתחת ל-0: הבורסה ניצחה</span>';
      $('#bt-chart').prepend(lg);
    }
  }

  function share(c, o) {
    const txt = 'מחשבון השקעות: נדל"ן מול בורסה\n' +
      'השקעה של ' + money(o.amount) + ' ל-' + o.years + ' שנים\n' +
      '🏠 נדל"ן: ' + money(c.re.netWorth) + ' (תשואה שנתית ' + pctf(c.re.irr * 100) + ')\n' +
      '📈 בורסה: ' + money(c.st.netWorth) + ' (תשואה שנתית ' + pctf(c.st.irr * 100) + ')\n' +
      'הנחות: עליית ערך ' + pctf(c.re.params.appreciation) + ', תשואת מניות ' + pctf(c.st.params.priceReturn + c.st.params.dividendYield) +
      ', משכנתא ' + pctf(c.re.params.mortgageRate) + '\n(התוצאה אחרי מיסים ועמלות. אין זה ייעוץ השקעות.)';
    if (window.AndroidBridge && window.AndroidBridge.share) { window.AndroidBridge.share(txt); return; }
    if (navigator.share) { navigator.share({ text: txt }).catch(function () {}); return; }
    if (navigator.clipboard) navigator.clipboard.writeText(txt).then(function () { toast('הסיכום הועתק'); }, function () { toast('ההעתקה נכשלה'); });
  }

  /* ---------- TOOLS view ---------- */
  const TOOLS = [
    { id: 'mortgage', title: '🏦 מחשבון משכנתא', fields: [
      { id: 'mAmount', label: 'סכום ההלוואה', type: 'money' }, { id: 'mRate', label: 'ריבית', type: 'pct' },
      { id: 'mYears', label: 'תקופה', type: 'years' },
      { id: 'mType', label: 'לוח סילוקין', type: 'select', options: [['spitzer', 'שפיצר'], ['equal', 'קרן שווה']] },
      { id: 'mIndexed', label: 'צמוד למדד', type: 'check' }, { id: 'mInfl', label: 'אינפלציה צפויה', type: 'pct' }
    ], compute: function (t, el) {
      const s = C.mortgageSchedule({ amount: t.mAmount, rate: t.mRate, years: t.mYears, type: t.mType, indexed: t.mIndexed }, t.mInfl);
      const last = s.rows.length ? s.rows[s.rows.length - 1].payment : 0;
      el.innerHTML = rows([
        ['החזר חודשי ראשון', money(s.firstPayment)],
        ['החזר חודשי אחרון', money(last)],
        ['סך הריבית', money(s.totalInterest)],
        t.mIndexed ? ['הפרשי הצמדה', money(s.totalIndexation)] : null,
        ['סך כל ההחזרים', money(s.totalPaid), true],
        ['כל שקל של הלוואה עולה', '₪' + (s.totalPaid / Math.max(1, t.mAmount)).toFixed(2)]
      ].filter(Boolean)) + '<div class="tool-chart" style="margin-top:10px"></div>';
      const yearsArr = [], bal = [], cumInt = [];
      let ci = 0;
      s.rows.forEach(function (r, i) { ci += r.interest; if ((i + 1) % 12 === 0) { yearsArr.push((i + 1) / 12); bal.push(r.balance); cumInt.push(ci); } });
      Ch.lineChart(el.querySelector('.tool-chart'), { x: yearsArr, xTitle: 'שנה ', format: money, height: 180,
        series: [{ name: 'יתרת הלוואה', color: COLORS.st, values: bal }, { name: 'ריבית מצטברת', color: COLORS.re, values: cumInt }] });
    } },
    { id: 'ptax', title: '🧾 מס רכישה', fields: [
      { id: 'ptPrice', label: 'מחיר הדירה', type: 'money' },
      { id: 'ptStatus', label: 'סוג', type: 'select', options: [['single', 'דירה יחידה'], ['additional', 'דירה נוספת']] }
    ], compute: function (t, el) {
      const tax = C.purchaseTax(t.ptPrice, t.ptStatus);
      el.innerHTML = rows([['מס רכישה', money(tax), true], ['שיעור אפקטיבי', pctf(tax / Math.max(1, t.ptPrice) * 100)]]) +
        '<p class="note">לפי מדרגות 2025–2027 (מוקפאות). לעולים, לנכים ולמקרים מיוחדים יש מדרגות אחרות.</p>';
    } },
    { id: 'afford', title: '🔑 כמה דירה אפשר לקנות?', fields: [
      { id: 'afEquity', label: 'הון עצמי', type: 'money' }, { id: 'afIncome', label: 'הכנסה נטו של משק הבית', type: 'money' },
      { id: 'afRate', label: 'ריבית', type: 'pct' }, { id: 'afYears', label: 'תקופה', type: 'years' },
      { id: 'afLtv', label: 'מימון מקסימלי', type: 'pct', help: '75% לדירה יחידה, 70% למשפרי דיור, 50% למשקיעים.' },
      { id: 'afRatio', label: 'החזר מקסימלי מההכנסה', type: 'pct', help: 'הבנקים מגבילים את ההחזר החודשי לכ-30%–40% מההכנסה הפנויה.' }
    ], compute: function (t, el) {
      const a = C.affordability(t.afEquity, t.afIncome, t.afRate, t.afYears, t.afLtv, t.afRatio);
      el.innerHTML = rows([
        ['מחיר דירה מקסימלי (בערך)', money(a.price), true], ['משכנתא', money(a.loan)],
        ['החזר חודשי מקסימלי', money(a.maxPayment)],
        ['המגבלה הקובעת', a.limitedBy === 'income' ? 'ההכנסה (יחס ההחזר)' : 'שיעור המימון']
      ]) + '<p class="note">החישוב לא כולל את עלויות הרכישה (מס, עו"ד, תיווך), וגם אותן צריך לממן מההון העצמי.</p>';
    } },
    { id: 'fees', title: '💸 כמה עולים לכם דמי הניהול?', fields: [
      { id: 'feAmount', label: 'סכום התחלתי', type: 'money' }, { id: 'feMonthly', label: 'הפקדה חודשית', type: 'money' },
      { id: 'feYears', label: 'שנים', type: 'years' }, { id: 'feRet', label: 'תשואה שנתית', type: 'pct' },
      { id: 'feFee', label: 'דמי ניהול שנתיים', type: 'pct' }
    ], compute: function (t, el) {
      const f = C.feeImpact(t.feAmount, t.feMonthly, t.feYears, t.feRet, t.feFee);
      el.innerHTML = rows([['בלי דמי ניהול', money(f.noFee)], ['עם דמי ניהול', money(f.withFee)],
        ['עלות דמי הניהול', money(f.lost), true], ['אחוז מהחיסכון שהולך לדמי ניהול', pctf(f.lostPct)]]);
    } },
    { id: 'fire', title: '🏖️ עצמאות כלכלית: כמה צריך כדי לחיות מהתשואה?', fields: [
      { id: 'fiExpenses', label: 'הוצאות חודשיות', type: 'money' },
      { id: 'fiWithdraw', label: 'שיעור משיכה שנתי', type: 'pct', help: '"כלל ה-4%": מושכים 4% מהתיק בשנה. ההנחה היא שתיק מגוון יחזיק מעמד כך 30 שנה ויותר.' },
      { id: 'fiCurrent', label: 'חיסכון קיים', type: 'money' }, { id: 'fiMonthly', label: 'חיסכון חודשי', type: 'money' },
      { id: 'fiRet', label: 'תשואה ריאלית', type: 'pct' }
    ], compute: function (t, el) {
      const target = C.fireTarget(t.fiExpenses, t.fiWithdraw);
      const y = C.yearsToTarget(target, t.fiCurrent, t.fiMonthly, t.fiRet);
      el.innerHTML = rows([['ההון הדרוש', money(target), true],
        ['זמן משוער עד היעד', isFinite(y) ? y.toFixed(1) + ' שנים' : 'מעל 100 שנה']]) +
        '<p class="note">הסכומים במונחי היום, כי התשואה שהזנתם היא ריאלית (אחרי אינפלציה). החישוב לא כולל מס.</p>';
    } },
    { id: 'goal', title: '🎯 כמה לחסוך כל חודש כדי להגיע ליעד?', fields: [
      { id: 'svTarget', label: 'סכום היעד', type: 'money' }, { id: 'svYears', label: 'בעוד', type: 'years' },
      { id: 'svRet', label: 'תשואה שנתית', type: 'pct' }, { id: 'svCurrent', label: 'כבר יש לי', type: 'money' }
    ], compute: function (t, el) {
      el.innerHTML = rows([['הפקדה חודשית נדרשת', money(C.savingsNeeded(t.svTarget, t.svYears, t.svRet, t.svCurrent)), true]]);
    } }
  ];

  function renderTools() {
    const root = $('#tools-list');
    root.textContent = '';
    TOOLS.forEach(function (tool) {
      const det = document.createElement('details'); det.className = 'card group';
      const sum = document.createElement('summary'); sum.textContent = tool.title; det.appendChild(sum);
      const body = document.createElement('div'); body.style.padding = '0 14px 14px';
      const fs = document.createElement('div'); fs.className = 'fields';
      const res = document.createElement('div'); res.style.marginTop = '12px';
      const run = debounce(function () { tool.compute(state.tools, res); save(); }, 120);
      tool.fields.forEach(function (f) { fs.appendChild(renderField(f, state.tools, run)); });
      body.appendChild(fs); body.appendChild(res); det.appendChild(body);
      det.addEventListener('toggle', function () { if (det.open) tool.compute(state.tools, res); });
      root.appendChild(det);
    });
    renderScenarios();
  }

  /* scenarios */
  function loadScenarios() { try { return JSON.parse(localStorage.getItem(SCEN_KEY) || '[]'); } catch (e) { return []; } }
  function saveScenarios(list) { try { localStorage.setItem(SCEN_KEY, JSON.stringify(list)); } catch (e) { toast('לא ניתן לשמור במכשיר הזה'); } }
  function renderScenarios() {
    const box = $('#scenarios');
    const list = loadScenarios();
    box.textContent = '';
    if (!list.length) {
      const p = document.createElement('p'); p.className = 'note'; p.textContent = 'עדיין לא שמרתם תרחישים.'; box.appendChild(p);
    }
    list.forEach(function (s, i) {
      const row = document.createElement('div'); row.className = 'scenario';
      const nm = document.createElement('div'); nm.className = 'name'; nm.textContent = s.name;
      const dt = document.createElement('div'); dt.className = 'date'; dt.textContent = new Date(s.at).toLocaleDateString('he-IL');
      nm.appendChild(dt);
      const ld = document.createElement('button'); ld.className = 'link-btn'; ld.textContent = 'טעינה';
      ld.addEventListener('click', function () {
        state.re = Object.assign({}, C.RE_DEFAULTS, s.re); state.st = Object.assign({}, C.ST_DEFAULTS, s.st);
        state.cmp = Object.assign({}, DEFAULT_STATE.cmp, s.cmp); save(); renderAllForms(); toast('התרחיש "' + s.name + '" נטען'); go('cmp');
      });
      const del = document.createElement('button'); del.className = 'link-btn'; del.textContent = 'מחיקה';
      del.addEventListener('click', function () { list.splice(i, 1); saveScenarios(list); renderScenarios(); });
      row.appendChild(nm); row.appendChild(ld); row.appendChild(del); box.appendChild(row);
    });
  }

  /* ---------- DATA view ---------- */
  const DATA_KEYS = ['sp500', 'sp500Ils', 'ta125', 'housing', 'cpi', 'usdils'];
  function renderData() {
    const chips = $('#data-ds'); chips.textContent = '';
    DATA_KEYS.forEach(function (k) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'chip' + (k === state.histKey ? ' on' : '');
      b.textContent = H[k].short;
      b.addEventListener('click', function () { state.histKey = k; save(); renderData(); });
      chips.appendChild(b);
    });
    const h = H[state.histKey];
    const s = C.stats(h.data);
    const years = h.data.map(function (_, i) { return h.start + i; });
    const end = years[years.length - 1];
    let html = '<h3>' + esc(h.name) + (h.approx ? '<span class="badge">משוער</span>' : '') + '</h3>' +
      '<p class="note" style="margin-top:0">' + h.start + '–' + end + ' · מקור: ' + esc(h.source) + '</p>' +
      '<div class="stat-grid">' +
      stat('תשואה שנתית מצטברת', pctf(s.cagr)) + stat('ממוצע פשוט', pctf(s.mean)) + stat('סטיית תקן', pctf(s.sd)) +
      stat('השנה הטובה', pctf(s.max)) + stat('השנה הגרועה', pctf(s.min)) + stat('שנים שליליות', s.negYears + '/' + s.n) +
      '</div><div id="data-chart"></div>';
    html += '<p class="note">' + esc(insight(state.histKey, s)) + '</p>';
    // rolling
    const rollRows = [5, 10, 20, 30].map(function (n) {
      const w = C.rollingWindows(h, n); if (!w.length) return null;
      const c = w.map(function (x) { return x.cagr; }).sort(function (a, b) { return a - b; });
      return [n + ' שנים', pctf(c[0]), pctf(C.percentile(c, 0.5)), pctf(c[c.length - 1]),
        pctf(w.filter(function (x) { return x.growth > 1; }).length / w.length * 100, 0)];
    }).filter(Boolean);
    if (rollRows.length) html += '<h3 style="margin-top:14px">תקופות החזקה רציפות</h3>' +
      table(['החזקה', 'גרועה', 'חציון', 'טובה', 'ברווח'], rollRows) +
      '<p class="note">התשואה השנתית הממוצעת בכל תקופה רציפה באורך הזה. ככל שתקופת ההחזקה ארוכה יותר, הסיכוי להפסד קטן.</p>';
    html += collapsible('כל הנתונים בטבלה', table(['שנה', 'שינוי'], years.slice().reverse().map(function (y) {
      return [y, pctf(h.data[y - h.start])];
    })));
    $('#data-body').innerHTML = html;
    Ch.barChart($('#data-chart'), { x: years, values: h.data, name: h.short, height: 200 });
  }
  function stat(l, v) { return '<div><div class="s-l">' + esc(l) + '</div><div class="s-v num">' + esc(v) + '</div></div>'; }
  function insight(key, s) {
    const growth = s.growth;
    switch (key) {
      case 'sp500': return 'דולר שהושקע ב-S&P 500 ב-1928 היה שווה ב-2025 כ-' + nf0.format(growth) + ' דולר, לפני מס ואינפלציה. אחרי אינפלציה של כ-3% בשנה, התשואה הריאלית היא כ-6.5%–7% בשנה.';
      case 'sp500Ils': return 'כך נראו התשואות למשקיע ישראלי שקנה את המדד בשקלים, כולל ההשפעה של שער הדולר. ' + nf0.format(100000) + ' ₪ שהושקעו ב-1995 היו שווים כ-' + nf0.format(100000 * growth) + ' ₪ לפני מס.';
      case 'housing': return 'מחירי הדירות בישראל עלו פי ' + growth.toFixed(1) + ' מאז 1995, בתוספת הכנסה משכירות של כ-2.5%–3.5% בשנה (ברוטו). בשנים 1996–2007 המחירים כמעט לא זזו, ובשנים 2008–2022 הם עלו בחדות.';
      case 'cpi': return 'האינפלציה המצטברת מאז 1995 היא פי ' + growth.toFixed(2) + '. בממוצע של ' + s.cagr.toFixed(1) + '% בשנה, כסף ששוכב בעו"ש מאבד כמחצית מערכו בכל כ-' + Math.round(70 / s.cagr) + ' שנים.';
      case 'ta125': return 'המדד הוא מדד מחיר, ולכן יש להוסיף עליו דיבידנד של כ-2.5%–3% בשנה. הנתונים לפני 2017 משוערים.';
      case 'usdils': return 'מספר חיובי פירושו שהדולר התחזק. בטווח הארוך השקל נשאר יציב יחסית מול הדולר, אבל בשנה בודדת השינוי יכול להיות 10% ויותר.';
    }
    return '';
  }

  /* ---------- navigation & wiring ---------- */
  const views = { re: renderRE, st: renderST, cmp: renderCMP, tools: renderTools, data: renderData };
  const rendered = {};
  function go(tab) {
    state.tab = tab; save();
    document.querySelectorAll('.view').forEach(function (v) { v.classList.toggle('active', v.id === 'view-' + tab); });
    document.querySelectorAll('.tabbar button').forEach(function (b) {
      const on = b.getAttribute('data-tab') === tab;
      b.classList.toggle('active', on); b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    window.scrollTo(0, 0);
    if (tab === 'tools' && rendered.tools) return;
    views[tab](); rendered[tab] = true;
  }

  const recalcRE = debounce(function () { save(); renderRE(); }, 160);
  const recalcST = debounce(function () { save(); renderST(); }, 220);
  const recalcCMP = debounce(function () { save(); renderCMP(); }, 260);

  function renderAllForms() {
    renderGroups($('#re-form'), RE_GROUPS, state.re, function (refresh) { if (refresh === true) renderAllForms(); recalcRE(); });
    renderGroups($('#st-form'), ST_GROUPS, state.st, function (refresh) { if (refresh === true) renderAllForms(); recalcST(); });
    renderFlat($('#cmp-form'), CMP_FIELDS, state.cmp, function () { recalcCMP(); });
    views[state.tab]();
  }

  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.remove('show'); }, 2200);
  }

  function applyTheme() {
    let th = 'auto';
    try { th = localStorage.getItem('invcalc.theme') || 'auto'; } catch (e) { /* ignore */ }
    if (th === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', th);
    return th;
  }

  function init() {
    applyTheme();
    document.querySelectorAll('.tabbar button').forEach(function (b) {
      b.addEventListener('click', function () { go(b.getAttribute('data-tab')); });
    });
    $('#theme-btn').addEventListener('click', function () {
      const cur = applyTheme();
      const next = cur === 'auto' ? 'dark' : cur === 'dark' ? 'light' : 'auto';
      try { localStorage.setItem('invcalc.theme', next); } catch (e) { /* ignore */ }
      applyTheme();
      toast(next === 'auto' ? 'ערכת נושא: לפי המכשיר' : next === 'dark' ? 'ערכת נושא: כהה' : 'ערכת נושא: בהירה');
      views[state.tab]();
    });
    $('#save-scenario').addEventListener('click', function () {
      const inp = $('#scenario-name');
      const name = (inp.value || '').trim() || ('תרחיש ' + new Date().toLocaleDateString('he-IL'));
      const list = loadScenarios();
      list.unshift({ name: name.slice(0, 60), at: Date.now(), re: state.re, st: state.st, cmp: state.cmp });
      saveScenarios(list.slice(0, 30)); inp.value = ''; renderScenarios(); toast('התרחיש נשמר');
    });
    const resetBtn = $('#reset-all');
    let resetArmed = null;
    resetBtn.addEventListener('click', function () {
      if (!resetArmed) {
        resetBtn.textContent = 'לחצו שוב לאישור האיפוס';
        resetArmed = setTimeout(function () { resetArmed = null; resetBtn.textContent = 'איפוס לברירת המחדל'; }, 3500);
        return;
      }
      clearTimeout(resetArmed); resetArmed = null; resetBtn.textContent = 'איפוס לברירת המחדל';
      const keepTab = state.tab;
      state = JSON.parse(JSON.stringify(DEFAULT_STATE)); state.tab = keepTab; save();
      rendered.tools = false; renderAllForms(); toast('הערכים אופסו');
    });
    renderAllForms();
    go(state.tab);
    let lastW = window.innerWidth;
    window.addEventListener('resize', debounce(function () {
      if (Math.abs(window.innerWidth - lastW) < 30) return;
      lastW = window.innerWidth; if (state.tab !== 'tools') views[state.tab]();
    }, 250));
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
