// ===== GOPD Planning App — Unified Engine (v2) =====
// หลักการ: Heat Rate เป็น "ตัวตั้งต้น" (single source of truth)
// ทุกหน้าใช้สูตรเดียวกัน:  Heat Input (BTU) = Energy (kWh) × Heat Rate (BTU/kWh)
//                          ปริมาณเชื้อเพลิง  = Heat Input (BTU) ÷ HHV (BTU/หน่วย)
// =====================================================================

// ---------- 1) ค่าคงที่กลาง (แก้ที่เดียว มีผลทั้งแอป) ----------
const CONFIG = {
  // Heat Rate ตั้งต้น (BTU/kWh) — ปรับได้จาก slider บนหัวแอป
  heatRate: 6500,
  hrMin: 6300,
  hrMax: 6700,
  hrStep: 10,
};

// ค่าความร้อน (HHV) ต่อหน่วยเชื้อเพลิง — หน่วยฐาน = BTU
const HHV = {
  ng:     1000,        // BTU/SCF
  diesel: 36500,       // BTU/L
  fo:     39500,       // BTU/L
  blcp:   25.07e6,     // BTU/Ton
  goc:    22.25e6,     // BTU/Ton
  hsa:    9.64e6,      // BTU/Ton
  mm:     12.09e6,     // BTU/Ton (แม่เมาะ)
};

// นิยามเชื้อเพลิงสำหรับ render (สี/ไอคอน/หน่วย/ตัวหาร)
const FUELS = [
  { key: 'ng',     name: 'ก๊าซธรรมชาติ (NG)', icon: '🔥', cls: 'ng',      hhv: HHV.ng,     kind: 'ng'     },
  { key: 'diesel', name: 'น้ำมันดีเซล',        icon: '⛽', cls: 'diesel',  hhv: HHV.diesel, kind: 'liquid' },
  { key: 'fo',     name: 'น้ำมันเตา (FO)',     icon: '🛢️', cls: 'fueloil', hhv: HHV.fo,     kind: 'liquid' },
  { key: 'blcp',   name: 'BLCP Coal',          icon: '⛰️', cls: 'coal',    hhv: HHV.blcp,   kind: 'coal'   },
  { key: 'goc',    name: 'GOC Coal',           icon: '⛰️', cls: 'coal',    hhv: HHV.goc,    kind: 'coal'   },
  { key: 'hsa',    name: 'HSA Coal',           icon: '⛰️', cls: 'coal',    hhv: HHV.hsa,    kind: 'coal'   },
  { key: 'mm',     name: 'MM Coal (แม่เมาะ)',  icon: '⛰️', cls: 'coal',    hhv: HHV.mm,     kind: 'coal'   },
];

// อ้างอิงเรือ LNG 1 ลำ — นิยามที่ HR baseline 6,500:
//   ความร้อน 3,000 BBTU → ผลิตไฟฟ้าได้ 461.54 ล้านหน่วย
// บนหน้า Rule of Thumb: slider = "ไฟฟ้าเทียบเท่า X ลำ" (fix energy)
//   เชื้อเพลิงที่ต้องใช้จะปรับตาม HR ปัจจุบัน
const SHIP_BBTU = 3000;
const SHIP_HEAT_BTU = SHIP_BBTU * 1e9;        // 3 × 10¹² BTU @ baseline
const HR_BASELINE = 6500;                      // BTU/kWh
const ENERGY_PER_SHIP_KWH = SHIP_HEAT_BTU / HR_BASELINE;  // = 461,538,461 kWh

// ---------- 2) เครื่องคำนวณกลาง (engine เดียว) ----------
// รับ Heat Input (BTU) คืนปริมาณเชื้อเพลิงทุกชนิด (หน่วยฐาน)
function fuelFromHeat(btu) {
  const out = {};
  FUELS.forEach(f => { out[f.key] = btu / f.hhv; });
  out._shipsLNG = btu / SHIP_HEAT_BTU; // เทียบเป็นจำนวนเรือ LNG
  return out;
}

// แปลง MW × ชั่วโมง × CF → พลังงาน (kWh) → Heat Input (BTU)
function heatInputFromGen(mw, hours, cfPct, heatRate) {
  const energyKwh = mw * 1000 * hours * (cfPct / 100); // kWh
  return energyKwh * heatRate;                          // BTU
}

// ---------- 3) ตัวช่วย format ----------
function fmt(n, dp) {
  if (!isFinite(n) || n === 0) return '0';
  if (n >= 10000) return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (n >= 1000)  return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (n >= 100)   return n.toFixed(0);
  if (n >= 10)    return n.toFixed(1);
  if (n >= 1)     return n.toFixed(2);
  return n.toFixed(3);
}

// แสดงปริมาณเชื้อเพลิงให้เลือกหน่วยอัตโนมัติ (คืน {val, unit, sub})
function displayFuel(kind, raw) {
  if (raw === 0) return { val: '0', unit: '', sub: '' };
  if (kind === 'ng') {
    const mmscf = raw / 1e6;
    if (mmscf >= 0.01)
      return { val: mmscf >= 100 ? mmscf.toFixed(1) : mmscf >= 10 ? mmscf.toFixed(2) : mmscf.toFixed(3),
               unit: 'MMSCF', sub: `= ${raw.toLocaleString('en-US',{maximumFractionDigits:0})} SCF` };
    return { val: raw >= 1000 ? raw.toLocaleString('en-US',{maximumFractionDigits:0}) : raw.toFixed(1),
             unit: 'SCF', sub: '' };
  }
  if (kind === 'liquid') {
    if (raw >= 1e6) {
      const ml = raw / 1e6;
      return { val: ml >= 100 ? ml.toFixed(1) : ml >= 10 ? ml.toFixed(2) : ml.toFixed(3),
               unit: 'ล้านลิตร', sub: `= ${raw.toLocaleString('en-US',{maximumFractionDigits:0})} L` };
    }
    return { val: raw >= 1000 ? raw.toLocaleString('en-US',{maximumFractionDigits:0}) : raw.toFixed(1),
             unit: 'ลิตร', sub: raw >= 100000 ? `= ${(raw/1e6).toFixed(4)} ล้านลิตร` : '' };
  }
  // coal
  if (raw >= 1e6)  return { val: (raw/1e6).toFixed(3), unit: 'ล้านตัน',
                            sub: `= ${raw.toLocaleString('en-US',{maximumFractionDigits:0})} ตัน` };
  if (raw >= 10000) return { val: (raw/1000).toFixed(1), unit: 'พันตัน',
                            sub: `= ${raw.toLocaleString('en-US',{maximumFractionDigits:0})} ตัน` };
  if (raw >= 1000) return { val: raw.toLocaleString('en-US',{maximumFractionDigits:0}), unit: 'ตัน',
                            sub: `= ${(raw/1000).toFixed(3)} พันตัน` };
  if (raw >= 1)    return { val: raw.toFixed(1), unit: 'ตัน', sub: '' };
  return { val: (raw*1000).toFixed(1), unit: 'kg', sub: '' };
}

// ---------- 4) Tab switching ----------
const tabs = document.getElementById('tabs');
if (tabs) {
  tabs.addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('panel-' + tab.dataset.tab).classList.add('active');
  });
}

// ---------- 5) Global Heat Rate control (หัวแอป) ----------
function syncHeatRateDisplays() {
  document.querySelectorAll('[data-hr-display]').forEach(el => {
    el.textContent = CONFIG.heatRate.toLocaleString('en-US');
  });
  const slider = document.getElementById('global-hr');
  if (slider && +slider.value !== CONFIG.heatRate) slider.value = CONFIG.heatRate;
}

function recalcAll() {
  syncHeatRateDisplays();
  renderFuelCards();
  updateGen();
  updateROT();
  updateConv();
}

const globalHr = document.getElementById('global-hr');
if (globalHr) {
  globalHr.addEventListener('input', () => {
    CONFIG.heatRate = parseFloat(globalHr.value) || CONFIG.heatRate;
    recalcAll();
  });
}

// ---------- 6) หน้า 1: เครื่องคำนวณหลัก (Generation → เชื้อเพลิง) ----------
function readTime() {
  const days = parseFloat(document.getElementById('gen-days')?.value) || 0;
  const hours = parseFloat(document.getElementById('gen-hours')?.value) || 0;
  const mins = parseFloat(document.getElementById('gen-mins')?.value) || 0;
  const totalHours = days * 24 + hours + mins / 60;
  return { days, hours, mins, totalHours };
}

function updateGen() {
  const mwEl = document.getElementById('gen-mw');
  if (!mwEl) return;

  const mw = parseFloat(mwEl.value) || 0;
  const cf = parseFloat(document.getElementById('gen-cf')?.value) || 100;
  const { totalHours } = readTime();

  // CF display
  const cfVal = document.getElementById('gen-cf-val');
  if (cfVal) cfVal.textContent = cf;

  // Time summary
  const tH = Math.floor(totalHours);
  const tM = Math.round((totalHours - tH) * 60);
  let summary;
  if (tH >= 24) {
    const d = Math.floor(tH / 24), h = tH % 24;
    summary = `${d} วัน`;
    if (h > 0) summary += ` ${h} ชม.`;
    if (tM > 0) summary += ` ${tM} นาที`;
    summary += ` (${totalHours.toFixed(1)} ชม.)`;
  } else {
    summary = `${tH} ชม. ${tM} นาที (${totalHours.toFixed(2)} ชม.)`;
  }
  const tEl = document.getElementById('gen-time-total');
  if (tEl) tEl.textContent = summary;

  // ----- engine -----
  const energyKwh = mw * 1000 * totalHours * (cf / 100);
  const energyGWh = energyKwh / 1e6;
  const heatBtu = energyKwh * CONFIG.heatRate;
  const mmbtu = heatBtu / 1e6;

  // พลังงานผลิตได้
  setText('gen-energy', fmt(energyGWh));
  setText('gen-energy-gwh', fmt(energyGWh));

  // Heat input รวม
  let hiStr;
  if (mmbtu >= 1000) hiStr = `${(mmbtu/1000).toFixed(2)} BBTU (= ${mmbtu.toLocaleString('en-US',{maximumFractionDigits:0})} MMBTU)`;
  else if (mmbtu >= 1) hiStr = `${mmbtu >= 100 ? mmbtu.toFixed(0) : mmbtu.toFixed(2)} MMBTU`;
  else hiStr = `${heatBtu.toLocaleString('en-US',{maximumFractionDigits:0})} BTU`;
  setText('gen-heat-input', hiStr);

  // เชื้อเพลิงทุกชนิด (engine เดียว)
  const fuel = fuelFromHeat(heatBtu);

  // การ์ดเชื้อเพลิงหลัก 4 ตัว + เรือ LNG
  renderGenFuelGrid(fuel, totalHours);

  // เทียบเรือ LNG
  setText('gen-ships', fuel._shipsLNG.toFixed(2));
}

function renderGenFuelGrid(fuel, totalHours) {
  const grid = document.getElementById('gen-fuel-grid');
  if (!grid) return;

  // เลือกหน่วย rate ตามระยะเวลา
  const perLabel = totalHours > 0 && totalHours < 24 ? '/ชม.' : '/วัน';
  const perDiv = totalHours > 0 && totalHours < 24 ? totalHours : (totalHours / 24);

  grid.innerHTML = FUELS.map(f => {
    const raw = fuel[f.key];
    const d = displayFuel(f.kind, raw);
    // rate เฉพาะของเหลว
    let rateHtml = '';
    if (f.kind === 'liquid' && perDiv > 0) {
      const ml = (raw / 1e6) / perDiv;
      rateHtml = `<div class="genf-rate">${ml.toFixed(3)} ล้าน L${perLabel}</div>`;
    } else if (f.key === 'ng') {
      rateHtml = `<div class="genf-rate">≈ ${fuel._shipsLNG.toFixed(2)} 🚢 เรือ LNG</div>`;
    } else if (f.kind === 'coal' && perDiv > 0) {
      const tpd = raw / perDiv;
      rateHtml = `<div class="genf-rate">${fmt(tpd)} ตัน${perLabel}</div>`;
    }
    return `
      <div class="genf-card ${f.cls}">
        <div class="genf-hhv">HHV ${hhvBadge(f)}</div>
        <div class="genf-top"><span class="genf-icon">${f.icon}</span><span class="genf-name">${f.name}</span></div>
        <div class="genf-val">${d.val} <span class="genf-unit">${d.unit}</span></div>
        <div class="genf-sub">${d.sub || ''}</div>
        ${rateHtml}
      </div>`;
  }).join('');
}

function hhvBadge(f) {
  if (f.kind === 'ng') return `${f.hhv.toLocaleString()} BTU/SCF`;
  if (f.kind === 'liquid') return `${f.hhv.toLocaleString()} BTU/L`;
  return `${(f.hhv/1e6).toFixed(2)} MBTU/Ton`;
}

// presets
document.querySelectorAll('.preset-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    setVal('gen-mw', btn.dataset.mw);
    setVal('gen-days', btn.dataset.days);
    setVal('gen-hours', btn.dataset.hours || 0);
    setVal('gen-mins', btn.dataset.minutes || 0);
    updateGen();
  });
});

['gen-mw', 'gen-days', 'gen-hours', 'gen-mins', 'gen-cf'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('input', updateGen);
});

// ---------- 7) หน้า 2: Rule of Thumb ----------
// Slider = "ไฟฟ้าเทียบเท่า X ลำที่ HR baseline 6,500"
// → Energy คงที่ (X × 461.54 ล้านหน่วย)
// → Heat Input = Energy × HR ปัจจุบัน  (เปลี่ยนตาม HR)
// → เชื้อเพลิงทุกชนิด (รวม LNG) = Heat ÷ HHV  (เปลี่ยนตาม HR)
function updateROT() {
  const input = document.getElementById('rot-ships-input');
  if (!input) return;
  const ships = parseFloat(input.value) || 0;

  // 1) Energy fixed by baseline (ไม่ขึ้นกับ HR ปัจจุบัน)
  const energyKwh = ships * ENERGY_PER_SHIP_KWH;
  const energyMU = energyKwh / 1e6;                       // ล้านหน่วย (GWh)
  const mwEquiv = energyKwh / 1000 / (30 * 24);          // MW × 30 วัน เทียบเท่า

  // 2) Heat Input ขึ้นกับ HR ปัจจุบัน
  const heatBtu = energyKwh * CONFIG.heatRate;
  const heatBBTU = heatBtu / 1e9;

  // 3) เชื้อเพลิงทุกชนิด ÷ HHV
  const fuel = fuelFromHeat(heatBtu);

  setText('rot-ships', ships.toFixed(1));
  setText('rot-ships-count', ships.toFixed(1));
  setText('rot-energy', fmt(energyMU));
  setText('rot-mw', fmt(mwEquiv));
  setText('rot-lng', fmt(heatBBTU));                      // LNG = heat (เปลี่ยนตาม HR)
  setText('rot-coal', (fuel.mm / 1e6).toFixed(3));        // ถ่านแม่เมาะเป็นตัวแทน
  setText('rot-diesel', fmt(fuel.diesel / 1e6));
  setText('rot-fueloil', fmt(fuel.fo / 1e6));

  // ป้ายเทียบเรือ LNG เทียบกับ baseline (เช่น 1.03 ลำ ถ้า HR แย่กว่า baseline)
  const lngShipsActual = heatBBTU / SHIP_BBTU;
  setText('rot-lng-ships', lngShipsActual.toFixed(2));

  renderShips(ships);
}

function renderShips(ships) {
  const c = document.getElementById('ship-container');
  if (!c) return;
  let n = Math.max(1, Math.round(ships));
  let partial = false, op = 1;
  if (ships < 1) { n = 1; partial = true; op = Math.max(0.3, ships); }
  let extra = '';
  if (n > 10) { extra = `<span class="ship-extra">+${n - 10}</span>`; n = 10; }
  let html = '';
  for (let i = 0; i < n; i++) {
    const delay = (i * 0.15).toFixed(2);
    html += `<span class="ship-emoji" style="animation-delay:${delay}s;opacity:${partial ? op : 1}">🚢</span>`;
  }
  c.innerHTML = html + extra;
}

const rotInput = document.getElementById('rot-ships-input');
if (rotInput) rotInput.addEventListener('input', updateROT);

// ---------- 8) หน้า 3: เชื้อเพลิงอ้างอิง + การ์ด HHV ----------
const fuelsCompare = [
  { name: 'Natural Gas', color: '#378ADD', price: '280 ฿/MMBTU', heat: '1,030 BTU/cf', co2: '53 kg/MMBTU' },
  { name: 'Coal',        color: '#5F5E5A', price: '3,200 ฿/ton', heat: '5,500 kcal/kg', co2: '94 kg/MMBTU' },
  { name: 'Lignite',     color: '#444441', price: '1,100 ฿/ton', heat: '2,800 kcal/kg', co2: '101 kg/MMBTU' },
  { name: 'Fuel Oil',    color: '#D85A30', price: '22 ฿/ลิตร',   heat: '9,600 kcal/L',  co2: '78 kg/MMBTU' },
  { name: 'Biomass',     color: '#0F6E56', price: '1,400 ฿/ton', heat: '3,800 kcal/kg', co2: '0 (neutral)' },
  { name: 'LNG',         color: '#1D9E75', price: '420 ฿/MMBTU', heat: '1,050 BTU/cf',  co2: '53 kg/MMBTU' },
];

function renderFuelCards() {
  const el = document.getElementById('fuel-grid');
  if (!el) return;
  el.innerHTML = fuelsCompare.map(f => `
    <div class="fuel-card">
      <h3 class="fuel-name"><span class="fuel-dot" style="background:${f.color}"></span>${f.name}</h3>
      <div class="fuel-stat"><span>ค่าความร้อน</span><b>${f.heat}</b></div>
      <div class="fuel-stat"><span>CO₂</span><b>${f.co2}</b></div>
    </div>`).join('');
}

// ---------- 9) หน้า 4: แปลงหน่วยพลังงาน ----------
const toKwh = { kwh:1, mwh:1000, gwh:1e6, mmbtu:293.071, kcal:0.001163, mj:0.277778, gj:277.778, toe:11630 };

function updateConv() {
  const inEl = document.getElementById('conv-in');
  if (!inEl) return;
  const v = parseFloat(inEl.value) || 0;
  const from = document.getElementById('conv-from').value;
  const to = document.getElementById('conv-to').value;
  const out = (v * toKwh[from]) / toKwh[to];

  let f;
  if (out === 0) f = '0';
  else if (out >= 1000) f = out.toLocaleString(undefined, { maximumFractionDigits: 2 });
  else if (out >= 1) f = out.toFixed(3);
  else f = out.toPrecision(4);

  document.getElementById('conv-out').value = f;
  setText('conv-summary', `${v.toLocaleString()} ${from.toUpperCase()} = ${f} ${to.toUpperCase()}`);
}

['conv-in','conv-from','conv-to'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('input', updateConv);
});
const swapBtn = document.getElementById('swap');
if (swapBtn) swapBtn.addEventListener('click', () => {
  const a = document.getElementById('conv-from'), b = document.getElementById('conv-to');
  [a.value, b.value] = [b.value, a.value];
  updateConv();
});

// ---------- helpers ----------
function setText(id, t) { const el = document.getElementById(id); if (el) el.textContent = t; }
function setVal(id, v) { const el = document.getElementById(id); if (el) el.value = v; }

// ---------- init ----------
function init() {
  recalcAll();
  updateROT();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();