// Run: node --test investment-calculator/tests/*.test.js
const test = require('node:test');
const assert = require('node:assert');
const C = require('../web/js/calc.js');
const D = require('../web/js/data.js');

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} expected ${b} got ${a}`);

test('Spitzer payment matches textbook value', () => {
  // 1,000,000 at 0.5%/month for 300 months -> 6443.01
  near(C.pmt(0.005, 300, 1e6), 6443.01, 0.01);
});

test('mortgage schedule repays the loan fully', () => {
  for (const type of ['spitzer', 'equal']) {
    const s = C.mortgageSchedule({ amount: 800000, rate: 5, years: 20, type }, 2);
    near(s.rows[s.rows.length - 1].balance, 0, 1e-6, type);
    near(s.totalPaid - s.totalInterest, 800000, 1e-3, type);
  }
});

test('indexed mortgage adds CPI linkage', () => {
  const s = C.mortgageSchedule({ amount: 500000, rate: 3, years: 20, indexed: true }, 3);
  assert.ok(s.totalIndexation > 50000);
  near(s.rows[s.rows.length - 1].balance, 0, 1e-6);
});

test('purchase tax brackets', () => {
  assert.strictEqual(C.purchaseTax(1500000, 'single'), 0);
  near(C.purchaseTax(2000000, 'single'), (2000000 - 1978745) * 0.035, 0.01);
  near(C.purchaseTax(1500000, 'additional'), 120000, 0.01);
  near(C.purchaseTax(7000000, 'additional'), 6055070 * 0.08 + (7000000 - 6055070) * 0.1, 0.01);
});

test('stocks with zero costs grow by compound rate', () => {
  const r = C.simulateStocks({ initial: 100000, priceReturn: 10, dividendYield: 0, expenseRatio: 0,
    buyFeePct: 0, wrapper: 'hishtalmut', years: 10 });
  near(r.netWorth, 100000 * Math.pow(1.1, 10), 1);
  near(r.irr * 100, 10, 0.01);
});

test('capital gains tax 25% on nominal gain', () => {
  const r = C.simulateStocks({ initial: 100000, priceReturn: 10, dividendYield: 0, expenseRatio: 0,
    buyFeePct: 0, wrapper: 'regular', years: 10 });
  const gross = 100000 * Math.pow(1.1, 10);
  near(r.netWorth, gross - (gross - 100000) * 0.25, 1);
});

test('fees reduce final value', () => {
  const base = { initial: 100000, years: 20, wrapper: 'hishtalmut' };
  const a = C.simulateStocks(Object.assign({ managementFee: 0 }, base));
  const b = C.simulateStocks(Object.assign({ managementFee: 0.7 }, base));
  assert.ok(b.netWorth < a.netWorth * 0.9);
});

test('real estate all-cash, no growth: net worth ≈ equity minus costs plus rent', () => {
  const r = C.simulateRealEstate({ price: 1000000, equity: 1000000, buyerStatus: 'none', lawyerPct: 0, brokerBuyPct: 0,
    renovation: 0, otherBuyCosts: 0, rent: 3000, rentGrowth: 0, vacancyMonths: 0, maintenancePct: 0, insurance: 0,
    appreciation: 0, inflation: 0, sellBrokerPct: 0, sellLawyerPct: 0, surplusRate: 0, years: 10 });
  assert.strictEqual(r.loan, 0);
  near(r.netWorth, 1000000 + 3000 * 120, 1);
  near(r.grossYield, 3.6, 1e-9);
});

test('mortgage deficits are funded out of pocket and mirrored in fair comparison', () => {
  const re = { price: 2000000, rent: 3000, buyerStatus: 'none', mortgageRate: 6 };
  const c = C.compare(re, { buyFeePct: 0 }, { amount: 1000000, years: 10 });
  assert.ok(c.re.outOfPocket > 0);
  near(c.st.contributed, 1000000 + c.re.outOfPocket, 1);
});

test('auto price respects LTV limit', () => {
  const price = C.maxPriceForEquity({ buyerStatus: 'additional' }, 500000);
  const r = C.simulateRealEstate({ buyerStatus: 'additional', price, equity: 500000 });
  assert.ok(r.ltv <= 50.01 && r.ltv > 49);
});

test('historical stats: S&P 500 long-run CAGR around 10%', () => {
  const s = C.stats(D.HISTORY.sp500.data);
  assert.ok(s.cagr > 9.5 && s.cagr < 10.5);
  assert.strictEqual(D.HISTORY.sp500.data.length, 2025 - 1928 + 1);
  assert.strictEqual(D.HISTORY.housing.data.length, D.HISTORY.cpi.data.length);
});

test('monte carlo & backtest produce sane output', () => {
  const mc = C.monteCarloStocks(Object.assign({}, C.ST_DEFAULTS, { years: 10 }), 'sp500', 300, 1);
  assert.ok(mc.p10 < mc.p50 && mc.p50 < mc.p90);
  const bt = C.backtestCompare({}, {}, { amount: 500000, years: 10, autoPrice: true }, 'sp500Ils');
  assert.strictEqual(bt.length, 31 - 10 + 1);
  const mcc = C.monteCarloCompare({}, {}, { amount: 500000, years: 10, autoPrice: true }, 'sp500Ils', 200, 1);
  assert.ok(mcc.reWinPct >= 0 && mcc.reWinPct <= 100);
});

test('tools', () => {
  near(C.fireTarget(10000, 4), 3000000, 1e-6);
  const need = C.savingsNeeded(1000000, 20, 0, 0);
  near(need, 1000000 / 240, 1e-6);
  const a = C.affordability(500000, 20000, 5, 25, 75, 35);
  assert.ok(a.price > 500000);
});
