/* ==========================================================
   FinSight — script.js
   Flow: Landing → Assessment → Review → Dashboard
   Data: user input → calculations (model) → render → localStorage
   Sections: 1 STATE  2 CALCULATIONS  3 DASHBOARD  4 ASSESSMENT  5 INIT
   There is NO built-in financial data. Everything comes from P (the profile).
   ========================================================== */

/* ---------- 1. STATE ---------- */
const KEY = 'finsight.profile.v1';       // later: replace with GET/POST to your Python API
let P = null;                            // the user's profile (see collect())
const ASSETS = [['Equity', 8], ['Mutual Funds', 6], ['Debt', 3], ['Gold', 4], ['Fixed Deposits', 1], ['Cash', 0]]; // [type, illustrative risk 0-10]
const PRESETS = [['Rent / Housing','fixed','essential'],['Loan EMI','fixed','essential'],['Groceries','variable','essential'],['Utilities','fixed','essential'],['Transport','variable','essential'],['Dining','variable','discretionary'],['Shopping','variable','discretionary'],['Entertainment','variable','discretionary']];
const PALETTE = ['#7B8A66','#C2A26A','#2A211B','#A8624A','#B7BFA3','#8C7B6B','#D9CBAA','#5E6B4F'];

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const fmt = n => inr.format(Math.round(n));
const pct = (n, d = 1) => `${n.toFixed(d)}%`;
const sum = a => a.reduce((x, y) => x + y, 0);
const num = v => { const n = parseFloat(v); return isFinite(n) ? n : 0; };
const save = () => localStorage.setItem(KEY, JSON.stringify(P));
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } };

/* ---------- 2. CALCULATIONS (pure helpers + one model) ---------- */
const monthsUntil = d => Math.max(1, Math.round((new Date(d) - new Date()) / (30.44 * 864e5)));
const requiredMonthly = g => Math.max(0, (g.target - g.current) / monthsUntil(g.date));

/** Monthly payment needed to turn pv into fv over n months at annual return r%. */
function requiredInvestment(fv, pv, r, n) {
  const i = r / 1200, g = Math.pow(1 + i, n);
  return Math.max(0, i === 0 ? (fv - pv) / n : (fv - pv * g) * i / (g - 1));
}
/** Future value of a monthly contribution plus a starting balance. */
function futureValue(pmt, pv, r, n) {
  const i = r / 1200, g = Math.pow(1 + i, n);
  return pv * g + (i === 0 ? pmt * n : pmt * (g - 1) / i);
}

/** Builds every derived number the dashboard needs from the profile. */
function model() {
  const income = P.income + P.other;
  const expenses = sum(P.expenses.map(e => e.amount));
  const surplus = income - expenses;
  const rate = income > 0 ? surplus / income * 100 : 0;
  const portfolio = ASSETS.map(([asset, risk]) => ({ asset, risk,
    value: sum(P.investments.filter(i => i.asset === asset).map(i => i.amount)) + (asset === 'Cash' ? P.savings : 0) })).filter(x => x.value > 0);
  const total = sum(portfolio.map(x => x.value));
  const group = key => P.expenses.reduce((o, e) => (o[e[key]] = (o[e[key]] || 0) + e.amount, o), {});
  const cover = expenses > 0 ? P.savings / expenses : 0;                       // months of expenses covered by savings
  const onTrack = P.goals.length ? P.goals.filter(g => g.current >= g.target || requiredMonthly(g) <= Math.max(0, surplus)).length / P.goals.length : 0.5;
  const score = Math.round(Math.min(1, Math.max(0, rate / 30)) * 40 + Math.min(1, cover / 6) * 30 + onTrack * 30);
  const hhi = total ? sum(portfolio.map(x => Math.pow(x.value / total * 100, 2))) : 0;
  const risk = total ? sum(portfolio.map(x => x.risk * x.value)) / total : 0;
  const sorted = [...P.expenses].sort((a, b) => b.amount - a.amount);
  return { income, expenses, surplus, rate, portfolio, total, need: group('need'), type: group('type'), cover, score, hhi, risk, sorted,
    riskLabel: risk < 3.5 ? 'Conservative' : risk < 5.5 ? 'Moderate' : 'Aggressive' };
}
/** 12-month projection: income grows at the income-growth rate, expenses at inflation. */
function projection(m) {
  const labels = [], inc = [], exp = [], bal = []; let b = P.savings;
  const now = new Date();
  for (let k = 1; k <= 12; k++) {
    labels.push(new Date(now.getFullYear(), now.getMonth() + k, 1).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }));
    inc.push(m.income * Math.pow(1 + P.growth / 100, k / 12));
    exp.push(m.expenses * Math.pow(1 + P.infl / 100, k / 12));
    b += inc[k - 1] - exp[k - 1]; bal.push(b);
  }
  return { labels, inc, exp, bal };
}
/** Insights are sentences assembled from calculated values. */
function insights(m) {
  const out = [];
  out.push([`Your current savings rate is ${pct(m.rate)}, which gives you ${m.surplus > 0 ? (m.rate >= 20 ? 'a healthy' : 'a modest') : 'no'} monthly surplus${m.surplus > 0 ? ' of ' + fmt(m.surplus) : ''}.`, m.rate >= 20 ? '' : m.surplus > 0 ? 'warn' : 'bad']);
  P.goals.slice(0, 3).forEach(g => {
    const left = g.target - g.current, mo = monthsUntil(g.date);
    if (left <= 0) return out.push([`You have already reached your ${g.name} goal.`, '']);
    if (m.surplus <= 0) return out.push([`With no monthly surplus, ${g.name} cannot progress yet.`, 'bad']);
    const n = Math.ceil(left / m.surplus);
    out.push([`At your current savings pace, you are approximately ${n} month${n === 1 ? '' : 's'} away from your ${g.name} goal${n <= mo ? ', ahead of your target date.' : ', behind your target date of ' + mo + ' months.'}`, n <= mo ? '' : 'warn']);
  });
  out.push([`Your savings cover ${m.cover.toFixed(1)} months of expenses${m.cover >= 6 ? ', above the common 6-month guideline.' : '. A common guideline is 6 months.'}`, m.cover >= 6 ? '' : m.cover >= 3 ? 'warn' : 'bad']);
  const disc = m.expenses ? (m.need.discretionary || 0) / m.expenses * 100 : 0;
  out.push([`Discretionary spending is ${pct(disc, 0)} of your expenses.`, disc > 30 ? 'warn' : '']);
  if (m.portfolio.length) { const t = [...m.portfolio].sort((a, b) => b.value - a.value)[0]; out.push([`${t.asset} makes up ${pct(t.value / m.total * 100, 0)} of your portfolio.`, t.value / m.total > .5 ? 'warn' : '']); }
  return out;
}

/* ---------- 3. DASHBOARD ---------- */
let charts = {};
function draw(id, config) {
  if (charts[id]) { charts[id].data = config.data; charts[id].update(); return; }
  config.options = Object.assign({ responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8 } } } }, config.options);
  charts[id] = new Chart($('#' + id), config);
}
const resetCharts = () => { Object.values(charts).forEach(c => c.destroy()); charts = {}; };
const money = { ticks: { callback: v => '₹' + (Math.abs(v) >= 1e5 ? (v / 1e5).toFixed(1) + 'L' : v / 1e3 + 'k') }, grid: { color: '#EAE1CE' } };
const kpi = (label, value, note = '', cls = '', box = '') => `<div class="kpi ${box}"><span>${label}</span><strong>${value}</strong><small class="${cls}">${note}</small></div>`;
const empty = t => `<p class="empty">${t}</p>`;

function renderOverview() {
  const m = model(), p = projection(m);
  $('#lede').textContent = m.income > 0
    ? `You keep ${pct(Math.max(0, m.rate), 0)} of what you earn, ${m.surplus > 0 ? fmt(m.surplus) + ' a month toward your future' : 'with expenses currently above income'}.`
    : 'Add your income to see your picture.';
  $('#kpis').innerHTML =
    kpi('Monthly income', fmt(m.income), P.other ? `Includes ${fmt(P.other)} other` : 'Primary income') +
    kpi('Monthly expenses', fmt(m.expenses), `${pct(m.income ? m.expenses / m.income * 100 : 0, 0)} of income`) +
    kpi('Net surplus', fmt(m.surplus), 'Per month', m.surplus >= 0 ? 'up' : 'down') +
    kpi('Savings rate', pct(m.rate), m.rate >= 20 ? 'Above 20% benchmark' : 'Below 20% benchmark', m.rate >= 20 ? 'up' : 'down') +
    kpi('Financial health', `${m.score}/100`, m.score >= 75 ? 'Strong' : m.score >= 55 ? 'Fair' : 'Needs attention', '', 'score');
  draw('incExpChart', { type: 'bar', data: { labels: p.labels, datasets: [
    { label: 'Income', data: p.inc, backgroundColor: '#7B8A66', borderRadius: 5 },
    { label: 'Expenses', data: p.exp, backgroundColor: '#C2A26A', borderRadius: 5 }] }, options: { scales: { y: money } } });
  draw('savingsChart', { type: 'line', data: { labels: p.labels, datasets: [{ label: 'Savings balance', data: p.bal, borderColor: '#7B8A66', backgroundColor: 'rgba(123,138,102,.14)', fill: true, tension: .35 }] },
    options: { scales: { y: money }, plugins: { legend: { display: false } } } });
  draw('catDonut', { type: 'doughnut', data: { labels: P.expenses.map(e => e.name), datasets: [{ data: P.expenses.map(e => e.amount), backgroundColor: PALETTE, borderColor: '#FBF8F1', borderWidth: 3 }] }, options: { cutout: '68%' } });
  $('#insights').innerHTML = insights(m).map(([t, c]) => `<li class="${c}">${t}</li>`).join('');
  $('#topLines').innerHTML = m.sorted.slice(0, 6).map(e =>
    `<tr><td>${e.name}<small>${e.type} · ${e.need}</small></td><td class="amt">${fmt(e.amount)}<small>${pct(e.amount / m.expenses * 100, 0)}</small></td></tr>`).join('');
}

function renderSpending() {
  const m = model(), p = projection(m), top = m.sorted[0];
  $('#spendKpis').innerHTML =
    kpi('Monthly expenses', fmt(m.expenses), 'Today') +
    kpi('Top category', top.name, `${fmt(top.amount)} · ${pct(top.amount / m.expenses * 100, 0)}`) +
    kpi('Essential share', pct((m.need.essential || 0) / m.expenses * 100, 0), 'Needs') +
    kpi('Fixed share', pct((m.type.fixed || 0) / m.expenses * 100, 0), 'Recurring commitments');
  draw('monthlyExpChart', { type: 'line', data: { labels: p.labels, datasets: [{ label: 'Expenses', data: p.exp, borderColor: '#C2A26A', tension: .3 }] }, options: { scales: { y: money }, plugins: { legend: { display: false } } } });
  draw('catBar', { type: 'bar', data: { labels: m.sorted.map(e => e.name), datasets: [{ data: m.sorted.map(e => e.amount), backgroundColor: '#7B8A66', borderRadius: 5 }] }, options: { indexAxis: 'y', scales: { x: money }, plugins: { legend: { display: false } } } });
  draw('essChart', { type: 'doughnut', data: { labels: ['Essential', 'Discretionary'], datasets: [{ data: [m.need.essential || 0, m.need.discretionary || 0], backgroundColor: ['#7B8A66', '#C2A26A'], borderColor: '#FBF8F1', borderWidth: 3 }] }, options: { cutout: '68%' } });
  draw('fixChart', { type: 'doughnut', data: { labels: ['Fixed', 'Variable'], datasets: [{ data: [m.type.fixed || 0, m.type.variable || 0], backgroundColor: ['#2A211B', '#A8624A'], borderColor: '#FBF8F1', borderWidth: 3 }] }, options: { cutout: '68%' } });
}

/* Budget: rows built once per visit; typing only updates calculated cells */
function renderBudget() {
  $('#budgetTbl tbody').innerHTML = P.expenses.map((e, i) =>
    `<tr><td>${e.name}</td><td><input type="number" min="0" step="any" data-i="${i}" value="${budgetOf(e)}" aria-label="${e.name} budget"></td><td>${fmt(e.amount)}</td><td></td><td></td></tr>`).join('');
  calcBudget();
}
const budgetOf = e => (P.budgets && P.budgets[e.name] !== undefined) ? P.budgets[e.name] : e.amount;
function calcBudget() {
  let tb = 0, ta = 0;
  $$('#budgetTbl tbody tr').forEach((row, i) => {
    const e = P.expenses[i], b = budgetOf(e), v = b - e.amount, u = b ? e.amount / b * 100 : (e.amount ? 999 : 0);
    tb += b; ta += e.amount;
    row.cells[3].innerHTML = `<span class="${v >= 0 ? 'up' : 'down'}">${v >= 0 ? '+' : '−'}${fmt(Math.abs(v))}</span>`;
    row.cells[4].innerHTML = `<div style="display:flex;gap:10px;align-items:center"><div class="bar" style="flex:1"><i class="${u > 100 ? 'over' : u > 85 ? 'warn' : ''}" style="width:${Math.min(u, 100)}%"></i></div><b>${u > 500 ? '>500%' : pct(u, 0)}</b></div>`;
  });
  $('#budgetTbl tfoot').innerHTML = `<tr><td>Total</td><td>${fmt(tb)}</td><td>${fmt(ta)}</td><td class="${tb >= ta ? 'up' : 'down'}">${fmt(tb - ta)}</td><td>${tb ? pct(ta / tb * 100, 0) : '—'}</td></tr>`;
}

function renderInvestments() {
  const m = model(); if (!m.total) { $('#invKpis').innerHTML = empty('Add savings or investments in your assessment to see allocation.'); return; }
  const top = [...m.portfolio].sort((a, b) => b.value - a.value)[0];
  $('#invKpis').innerHTML =
    kpi('Portfolio value', fmt(m.total), 'Investments plus cash savings') +
    kpi('Risk level', m.riskLabel, `Weighted score ${m.risk.toFixed(1)}/10`) +
    kpi('Largest holding', top.asset, pct(top.value / m.total * 100, 0) + ' of portfolio') +
    kpi('Concentration', m.hhi > 2500 ? 'High' : m.hhi > 1800 ? 'Moderate' : 'Diversified', `HHI ${Math.round(m.hhi)}`);
  draw('allocDonut', { type: 'doughnut', data: { labels: m.portfolio.map(x => x.asset), datasets: [{ data: m.portfolio.map(x => x.value), backgroundColor: PALETTE, borderColor: '#FBF8F1', borderWidth: 3 }] }, options: { cutout: '68%' } });
  $('#invTbl tbody').innerHTML = m.portfolio.map(x => `<tr><td>${x.asset}</td><td>${fmt(x.value)}</td><td>${pct(x.value / m.total * 100)}</td><td>${x.risk}</td></tr>`).join('');
}

function renderGoals() {
  $('#goalCards').innerHTML = !P.goals.length ? empty('No goals yet. Edit your assessment to add one.') : P.goals.map(g => {
    const p = Math.min(100, g.current / g.target * 100);
    return `<article class="card goal"><h2>${g.name}<span class="muted">${pct(p, 0)}</span></h2>
      <div class="big">${fmt(g.current)}</div><p class="muted">of ${fmt(g.target)}</p>
      <div class="bar" style="margin-top:12px"><i style="width:${p}%"></i></div>
      <dl><dt>Target date</dt><dd>${new Date(g.date).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}</dd>
      <dt>Months left</dt><dd>${monthsUntil(g.date)}</dd><dt>Remaining</dt><dd>${fmt(Math.max(0, g.target - g.current))}</dd>
      <dt>Required monthly saving</dt><dd>${fmt(requiredMonthly(g))}</dd></dl></article>`;
  }).join('');
}

/* Scenario: sliders start from the user's own assumptions */
function initScenario() {
  $('#s_goal').innerHTML = P.goals.map((g, i) => `<option value="${i}">${g.name}</option>`).join('') || '<option value="">No goals</option>';
  scenReset();
}
function scenReset() { $('#s_inc').value = P.growth; $('#s_exp').value = P.infl; $('#s_inf').value = P.infl; $('#s_ret').value = P.ret; renderScenario(); }
function renderScenario() {
  const v = id => num($('#s_' + id).value), [gi, ge, inf, ret] = [v('inc'), v('exp'), v('inf'), v('ret')];
  ['inc', 'exp', 'inf', 'ret'].forEach(k => $('#o_' + k).textContent = pct(v(k)));
  const m = model(), g = P.goals[$('#s_goal').value];
  const annual = m.income * 12 * (1 + gi / 100) - m.expenses * 12 * (1 + ge / 100);
  if (!g) { $('#scenKpis').innerHTML = kpi('Projected annual savings', fmt(annual), 'Next 12 months'); return; }
  const n = monthsUntil(g.date), yrs = n / 12;
  const futureGoal = g.target * Math.pow(1 + inf / 100, yrs);
  const need = requiredInvestment(futureGoal, g.current, ret, n);
  const pos = futureValue(Math.max(0, annual) / 12, m.total, ret, n);
  $('#scenKpis').innerHTML =
    kpi('Projected annual savings', fmt(annual), annual >= 0 ? 'Next 12 months' : 'Deficit', annual >= 0 ? 'up' : 'down') +
    kpi('Future goal amount', fmt(futureGoal), `${g.name} in ${yrs.toFixed(1)} yrs`) +
    kpi('Required monthly investment', fmt(need), need * 12 > annual ? 'Exceeds projected savings' : 'Within projected savings', need * 12 > annual ? 'down' : 'up') +
    kpi('Projected position', fmt(pos), `${fmt(pos / Math.pow(1 + inf / 100, yrs))} in today's money`);
  const labels = [], nom = [], real = [];
  for (let y = 0; y <= Math.ceil(yrs); y++) {
    const val = futureValue(Math.max(0, annual) / 12, m.total, ret, y * 12);
    labels.push(y ? `Year ${y}` : 'Now'); nom.push(Math.round(val)); real.push(Math.round(val / Math.pow(1 + inf / 100, y)));
  }
  draw('scenChart', { type: 'line', data: { labels, datasets: [
    { label: 'Nominal position', data: nom, borderColor: '#7B8A66', backgroundColor: 'rgba(123,138,102,.12)', fill: true, tension: .3 },
    { label: 'Inflation-adjusted', data: real, borderColor: '#C2A26A', borderDash: [6, 4], tension: .3 }] }, options: { scales: { y: money } } });
}

const VIEWS = {
  overview: ['Overview', 'Your financial position at a glance', renderOverview], spending: ['Spending Analytics', 'Where your money goes', renderSpending],
  budget: ['Budget Analysis', 'Plan versus reality', renderBudget], investments: ['Investments', 'Portfolio mix and risk', renderInvestments],
  goals: ['Financial Goals', 'Progress and required savings', renderGoals], scenario: ['Scenario Analysis', 'Test assumptions, see the impact', renderScenario] };

function show(name) {
  const [title, sub, render] = VIEWS[name];
  $$('.view').forEach(s => s.classList.toggle('active', s.id === name));
  $$('.nav-btn[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  $('#viewTitle').textContent = title; $('#viewSub').textContent = sub; $('#sidebar').classList.remove('open');
  render();
}
function enterApp() {
  resetCharts(); initScenario();
  $('#periodChip').textContent = new Date().toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  $('#avatar').textContent = P.emp.slice(0, 2).toUpperCase();
  screen('app'); show('overview');
}

/* ---------- 4. ASSESSMENT ---------- */
const screen = n => { $$('.screen').forEach(s => s.classList.toggle('active', s.id === n)); scrollTo(0, 0); };
const opts = (list, sel) => list.map(o => `<option ${o === sel ? 'selected' : ''}>${o}</option>`).join('');
const ROWS = {
  exp: (v = {}) => `<div class="row"><input data-k="name" placeholder="Category" value="${v.name || ''}"><input data-k="amount" type="number" min="0" step="any" placeholder="Per month" value="${v.amount ?? ''}">
    <select data-k="type" aria-label="Pattern">${['fixed', 'variable'].map(o => `<option ${o === v.type ? 'selected' : ''}>${o}</option>`).join('')}</select>
    <select data-k="need" aria-label="Nature">${['essential', 'discretionary'].map(o => `<option ${o === v.need ? 'selected' : ''}>${o}</option>`).join('')}</select><button type="button" class="x" aria-label="Remove">×</button></div>`,
  inv: (v = {}) => `<div class="row two"><select data-k="asset" aria-label="Type">${opts(ASSETS.map(a => a[0]), v.asset)}</select><input data-k="amount" type="number" min="0" step="any" placeholder="Current value" value="${v.amount ?? ''}"><button type="button" class="x" aria-label="Remove">×</button></div>`,
  goal: (v = {}) => `<div class="row goals"><input data-k="name" placeholder="Goal name" value="${v.name || ''}"><input data-k="target" type="number" min="1" step="any" placeholder="Target" value="${v.target ?? ''}"><input data-k="current" type="number" min="0" step="any" placeholder="Saved so far" value="${v.current ?? ''}"><input data-k="date" type="date" value="${v.date || ''}" aria-label="Target date"><button type="button" class="x" aria-label="Remove">×</button></div>`
};
const BOX = { exp: '#expRows', inv: '#invRows', goal: '#goalRows' };
const addRow = (k, v) => $(BOX[k]).insertAdjacentHTML('beforeend', ROWS[k](v));
const rows = sel => $$('.row', $(sel)).map(r => Object.fromEntries($$('[data-k]', r).map(i => [i.dataset.k, i.value])));

/** Reads the whole form into a profile object. */
function collect() {
  const g = id => $('#' + id).value;
  return { age: num(g('age')), emp: g('emp'), income: num(g('income')), other: num(g('other')), savings: num(g('savings')),
    expenses: rows(BOX.exp).map(r => ({ name: r.name.trim() || 'Other', amount: num(r.amount), type: r.type, need: r.need })).filter(e => e.amount > 0),
    investments: rows(BOX.inv).map(r => ({ asset: r.asset, amount: num(r.amount) })).filter(i => i.amount > 0),
    goals: rows(BOX.goal).map(r => ({ name: r.name.trim(), target: num(r.target), current: num(r.current), date: r.date })).filter(x => x.name && x.target > 0 && x.date),
    ret: num(g('ret')), infl: num(g('infl')), growth: num(g('growth')), budgets: (P && P.budgets) || {} };
}
/** Writes a saved profile back into the form (used by "Edit my assessment"). */
function populate(p) {
  ['age', 'emp', 'income', 'other', 'savings', 'ret', 'infl', 'growth'].forEach(k => $('#' + k).value = p[k] || (k === 'emp' ? '' : p[k] === 0 ? 0 : ''));
  Object.entries(BOX).forEach(([k, s]) => $(s).innerHTML = '');
  p.expenses.forEach(e => addRow('exp', e)); p.investments.forEach(i => addRow('inv', i)); p.goals.forEach(x => addRow('goal', x));
  if (!p.goals.length) addRow('goal');
}
function freshForm() {
  $$('input,select', $('#assess')).forEach(i => i.value = '');
  Object.values(BOX).forEach(s => $(s).innerHTML = '');
  PRESETS.forEach(([name, type, need]) => addRow('exp', { name, type, need })); addRow('inv'); addRow('goal');
}

let step = 0;
const TITLES = ['About you', 'Expenses', 'Investments', 'Goals', 'Assumptions', 'Review'];
function goStep(i) {
  step = i; $('#stepMsg').textContent = '';
  $$('.panel').forEach((p, k) => p.classList.toggle('active', k === i));
  $('#steps').innerHTML = TITLES.map((t, k) => `<li class="${k <= i ? 'on' : ''}">${t}${k < 5 ? ' ·' : ''}</li>`).join('').replace(/ ·/g, ' /');
  $('#trackFill').style.width = (i + 1) / 6 * 100 + '%';
  $('#back').style.visibility = i ? 'visible' : 'hidden';
  $('#next').textContent = i === 5 ? 'Reveal my financial picture' : 'Continue';
  if (i === 5) renderReview();
}
function validate(i) {
  const msg = t => ($('#stepMsg').textContent = t, false);
  for (const el of $$('input,select', $$('.panel')[i])) if (!el.checkValidity()) { el.reportValidity(); return false; }
  const d = collect();
  if (i === 1 && !d.expenses.length) return msg('Add at least one expense with an amount.');
  if (i === 2 && rows(BOX.inv).some(r => num(r.amount) < 0)) return msg('Investment values cannot be negative.');
  if (i === 3 && rows(BOX.goal).some(r => (r.name.trim() || r.target || r.date) && !(r.name.trim() && num(r.target) > 0 && r.date))) return msg('Each goal needs a name, a target amount and a target date.');
  return true;
}
function renderReview() {
  const d = collect(), inc = d.income + d.other, exp = sum(d.expenses.map(e => e.amount)), sur = inc - exp;
  $('#reviewBody').innerHTML = `<div class="card"><div><span>Monthly income</span><b>${fmt(inc)}</b></div><div><span>Monthly expenses</span><b>${fmt(exp)}</b></div>
    <div><span>Monthly surplus</span><b>${fmt(sur)}</b></div><div><span>Savings rate</span><b>${inc ? pct(sur / inc * 100) : '—'}</b></div></div>
    <p class="muted">${d.age} yrs · ${d.emp} · ${fmt(d.savings)} savings · ${d.expenses.length} expense lines · ${d.investments.length} investments · ${d.goals.length} goals · return ${d.ret}%, inflation ${d.infl}%, income growth ${d.growth}%</p>`;
}

/* ---------- 5. INIT ---------- */
document.addEventListener('DOMContentLoaded', () => {
  Chart.defaults.font.family = "'Manrope', system-ui, sans-serif"; Chart.defaults.color = '#7A6C5F';
  $$('.panel').forEach(p => p.insertAdjacentHTML('afterbegin', `<h2>${p.dataset.title}</h2><p class="sub">${p.dataset.sub}</p>`));
  $('#startBtn').onclick = () => { freshForm(); goStep(0); screen('assess'); };
  $('#next').onclick = () => {
    if (!validate(step)) return;
    if (step < 5) return goStep(step + 1);
    P = collect(); save(); enterApp();                      // "Reveal my financial picture"
  };
  $('#back').onclick = () => goStep(step - 1);
  $$('[data-add]').forEach(b => b.onclick = () => addRow(b.dataset.add));
  $('#assess').addEventListener('click', e => { if (e.target.classList.contains('x')) e.target.closest('.row').remove(); });
  $$('.nav-btn[data-view]').forEach(b => b.onclick = () => show(b.dataset.view));
  $('#menuBtn').onclick = () => $('#sidebar').classList.toggle('open');
  $('#editBtn').onclick = () => { populate(P); goStep(0); screen('assess'); };
  $('#resetBtn').onclick = () => { if (confirm('Clear all saved data from this browser?')) { localStorage.removeItem(KEY); P = null; resetCharts(); screen('landing'); } };
  $$('#scenario input,#s_goal').forEach(i => i.addEventListener('input', renderScenario));
  $('#scenReset').onclick = scenReset;
  $('#budgetTbl tbody').addEventListener('input', e => {    // live budget recalculation
    const exp = P.expenses[e.target.dataset.i]; P.budgets = P.budgets || {}; P.budgets[exp.name] = num(e.target.value); save(); calcBudget();
  });
  P = load();
  if (P && P.expenses) enterApp(); else screen('landing');
});
