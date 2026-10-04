// Opt-in browser layout check. Uses an isolated headless Chrome profile and synthetic consultation data.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, basename } from 'node:path';

const appUrl = process.env.PLANPILOT_TEST_URL || 'http://127.0.0.1:5173/';
const candidates = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean);
let executable;
for (const path of candidates) { try { await access(path); executable = path; break; } catch {} }
if (!executable) throw new Error('Set CHROME_PATH to a Chromium executable for the opt-in visual check.');
const profile = await mkdtemp(join(tmpdir(), 'planpilot-headless-'));
const browser = spawn(executable, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
let socket;
try {
  let port;
  for (let i = 0; i < 100; i++) { try { port = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); break; } catch { await new Promise(resolve => setTimeout(resolve, 100)); } }
  if (!port) throw new Error('Headless browser did not start.');
  const page = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  const pending = new Map(); let id = 0; const errors = [];
  socket.addEventListener('message', event => { const data = JSON.parse(event.data); if (data.id) { const entry = pending.get(data.id); if (!entry) return; clearTimeout(entry.timer); pending.delete(data.id); data.error ? entry.reject(new Error(data.error.message)) : entry.resolve(data.result); } else if (data.method === 'Runtime.exceptionThrown') errors.push(data.params.exceptionDetails.text); });
  socket.addEventListener('close', () => { for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error('Headless browser connection closed.')); } pending.clear(); });
  function command(method, params = {}) { return new Promise((resolve, reject) => { const key = ++id; const timer = setTimeout(() => { pending.delete(key); reject(new Error(`Browser command timed out: ${method}`)); }, 15000); pending.set(key, { resolve, reject, timer }); socket.send(JSON.stringify({ id: key, method, params })); }); }
  async function evaluate(expression) { const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.text); return result.result.value; }
  async function waitFor(expression) { for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await new Promise(resolve => setTimeout(resolve, 100)); } throw new Error(`Timed out: ${expression}`); }
  const state = { currency: 'USD', plan: { remainingDeductible: 50, remainingBenefit: 100, annualMaximum: 1500, annualDeductible: 50, benefitYearStart: '2026-07-01', benefitYearEnd: '2027-06-30', nextYearAnnualMaximum: 1500, nextYearDeductible: 50, renewalConfirmed: true }, procedures: [{ id: 'crown', name: 'Porcelain crown', code: 'D2740', quote: 1200, quoteType: 'total_fee', allowedAmount: null, insurancePercent: 50, covered: true, deductibleApplies: true, network: 'in', feeBasis: 'quoted_fee', date: '2027-06-15', earliestDate: '2027-06-15', latestDate: '2027-08-01', dentistApprovedWindow: true, dependsOn: [] }] };
  const turn = { id: 'visual-fixture', kind: 'ready', topic: 'Your costs', title: 'Your quote, with a clearer picture.', context: 'Confirm the details below to calculate your personal cost and explore alternatives.', choices: [], facts: [{ label: 'Procedure', value: 'Porcelain crown', basis: 'user', evidence: 'A porcelain crown' }], actions: ['Confirm your dentist’s approved dates.'], uncertainties: [], financialProposal: state };
  const base = { topic: 'Your insurance', facts: [], actions: [], uncertainties: [], context: '' };
  const turns = [
    { ...base, id: 'knowledge', kind: 'question', title: 'Do you know what your plan helps pay for?', context: 'We’ll keep this simple, one useful detail at a time.', choices: ['Yes, a little', 'No', 'I have a plan file'] },
    { ...base, id: 'insurance-upload', kind: 'document', documentPurpose: 'insurance', title: 'Let’s look at your insurance together.', context: 'Share a card or plan file, or we can work through it in plain words.', choices: ['Upload my card or plan', 'Guide me in simple words', 'I don’t have a file with me'] },
    { ...base, id: 'coverage-review', kind: 'review', title: 'Here’s what we know so far.', context: 'Check these details. You can change anything before we continue.', choices: ['Looks right, continue', 'I need to change something'], facts: [{ label: 'Your insurer', value: 'Example Dental Plan', basis: 'user', evidence: 'Example Dental Plan' }, { label: 'Most your plan pays per year', value: '$1,500', basis: 'user', evidence: '$1,500' }, { label: 'Your plan can still pay this year', value: '$100', basis: 'user', evidence: '$100' }], uncertainties: ['The price your dentist quoted'] },
    { ...base, id: 'bill-upload', kind: 'document', documentPurpose: 'bill', topic: 'Your dentist’s bill', title: 'Do you have a bill or price estimate?', context: 'Upload it, or tell me the treatment names and prices by typing or speaking.', choices: ['Upload my bill or estimate', 'I’ll type or speak it', 'Not yet'] },
    turn,
  ];
  await command('Page.enable'); await command('Runtime.enable');
  const demoProfile = { id: 'f82451c4-42bd-4fd0-8f36-ff8a79697e06', name: 'Alex Morgan', email: 'alex.morgan@example.com', phone: '', company: 'Example Company', createdAt: '2026-10-04T00:00:00.000Z' };
  await command('Page.addScriptToEvaluateOnNewDocument', { source: `
    if(location.search.includes('visualFresh=1')) { localStorage.clear(); localStorage.setItem('planpilot.theme',new URLSearchParams(location.search).get('theme')==='light'?'light':'dark'); }
    const originalFetch=window.fetch.bind(window);const turns=${JSON.stringify(turns)};let call=0;
    window.fetch=async(url,options)=>{
      const path=String(url);const json=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
      if(path.endsWith('/api/account')){const firstVisit=!localStorage.getItem('visual.visited');localStorage.setItem('visual.visited','true');return json({profile:JSON.parse(localStorage.getItem('visual.profile')||'null')||${JSON.stringify(demoProfile)},snapshot:JSON.parse(localStorage.getItem('visual.snapshot')||'null'),firstVisit,storage:'supabase'});}
      if(path.endsWith('/api/profile')){const profile={...${JSON.stringify(demoProfile)},...JSON.parse(options.body)};localStorage.setItem('visual.profile',JSON.stringify(profile));return json(profile);}
      if(path.endsWith('/api/snapshot')){const snapshot=JSON.parse(options.body);snapshot.financialResult=snapshot.financialState?await(await originalFetch('/api/estimate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({state:snapshot.financialState})})).json():null;localStorage.setItem('visual.snapshot',JSON.stringify(snapshot));return json(snapshot);}
      if(path.endsWith('/api/consult'))return json(turns[Math.min(call++,turns.length-1)]);
      return originalFetch(url,options);
    };` });
  const output = resolve('tests/artifacts'); await mkdir(output, { recursive: true });
  for (const [viewport, width, height, theme] of [['desktop', 1440, 1000, 'dark'], ['mobile', 390, 844, 'dark'], ['desktop', 1440, 1000, 'light'], ['mobile', 390, 844, 'light']]) {
    const name = theme === 'dark' ? viewport : `${viewport}-light`;
    await command('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: viewport === 'mobile' });
    await command('Page.navigate', { url: `${appUrl}?visualFresh=1&theme=${theme}` });
    await waitFor(`!!document.querySelector('.journey .primary')`);
    assert.equal(await evaluate(`document.documentElement.dataset.theme`),theme);
    await capture('welcome');
    await evaluate(`document.querySelector('.journey .primary').click()`);
    await waitFor(`!!document.querySelector('.intent-continue')`);
    await capture('intent');
    await evaluate(`document.querySelector('.goal-list input').click(); document.querySelector('.intent-continue').click()`);
    async function capture(file) {
      await evaluate('document.fonts.ready');
      await new Promise(resolve => setTimeout(resolve, 350));
      const overflow = await evaluate(`({page:document.documentElement.scrollWidth>innerWidth,modal:!!document.querySelector('dialog')&&document.querySelector('dialog').scrollWidth>document.querySelector('dialog').clientWidth+2})`);
      assert.deepEqual(overflow, { page: false, modal: false }, `${name} ${file} must not scroll horizontally`);
      const screenshot = await command('Page.captureScreenshot', { format: 'png' });
      await writeFile(join(output, `${name}-${file}.png`), Buffer.from(screenshot.data, 'base64'));
    }
    async function continueStep() { await evaluate(`document.querySelector('.response-actions .primary').click()`); }
    async function inputText(text) { await evaluate(`(() => { const field=document.querySelector('#consult-answer'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(field,${JSON.stringify(text)}); field.dispatchEvent(new Event('input',{bubbles:true})); })()`); }
    await waitFor(`document.querySelector('#consultation-title')?.textContent.includes('helps pay')`);
    await capture('question');
    await evaluate(`document.querySelector('.consult-appearance .theme-toggle').click()`);
    await waitFor(`document.documentElement.dataset.theme==='${theme === 'dark' ? 'light' : 'dark'}'`);
    assert.equal(await evaluate(`localStorage.getItem('planpilot.theme')`),theme === 'dark' ? 'light' : 'dark');
    await evaluate(`document.querySelector('.consult-appearance .theme-toggle').click()`);
    await waitFor(`document.documentElement.dataset.theme==='${theme}'`);
    await evaluate(`Array.from(document.querySelectorAll('.consult-choice')).find(l=>l.textContent.startsWith('No')).querySelector('input').click()`); await continueStep();
    await waitFor(`!!document.querySelector('.file-drop')`); await capture('insurance-upload');
    await inputText('Example Dental Plan. My plan pays up to $1,500 and can still pay $100 this year.'); await continueStep();
    await waitFor(`!!document.querySelector('.checkpoint-body')`); await capture('coverage-review'); await continueStep();
    await waitFor(`document.querySelector('#consultation-title')?.textContent.includes('bill or price')`); await capture('bill-upload');
    await inputText('My dentist quoted $1,200 for a porcelain crown.'); await continueStep();
    await waitFor(`!!document.querySelector('.financial-workspace')`);
    await evaluate(`document.querySelector('.financial-workspace .finance-check input').click(); Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Calculate my personal cost').click()`);
    await waitFor(`!!document.querySelector('.cost-result')`);
    assert.ok((await evaluate(`document.querySelector('.cost-totals').innerText`)).includes('$1,100.00'));
    await capture('quote');
    await evaluate(`Array.from(document.querySelectorAll('[role=tab]')).find(b=>b.textContent==='Treatment dates').click()`); await capture('dates');
    await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='View Overview').click()`);
    await waitFor(`!!document.querySelector('.overview-metrics')&&!document.querySelector('.journey-modal')`);
    await capture('overview');
    assert.ok((await evaluate(`document.querySelector('.overview-metrics').innerText`)).includes('$1,100.00'));
    await evaluate(`document.querySelector('[aria-label="Open navigation menu"]').click()`);
    await waitFor(`!!document.querySelector('.navigation-drawer[open]')`);await capture('navigation');
    await evaluate(`document.querySelector('.navigation-link[aria-label="Settings"]').click()`);
    await waitFor(`!!document.querySelector('.profile-form')`);await capture('settings');
    await waitFor(`localStorage.getItem('visual.snapshot')&&JSON.parse(localStorage.getItem('visual.snapshot')).financialState`);
    await command('Page.navigate',{url:appUrl});
    await waitFor(`!!document.querySelector('.overview-metrics')`);
    assert.equal(await evaluate(`document.documentElement.dataset.theme`),theme,'Selected theme must survive a reload');
    await capture('returning-overview');
    await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.startsWith('Review My Plan')).click()`);
    await waitFor(`!!document.querySelector('.financial-workspace .cost-result')`);await capture('resumed-plan');
    await evaluate(`document.querySelector('.consult-appearance .theme-toggle').click()`);
    const switched = theme === 'dark' ? 'light' : 'dark';
    await waitFor(`document.documentElement.dataset.theme==='${switched}'`);
    await command('Page.navigate',{url:appUrl});
    await waitFor(`!!document.querySelector('.overview-metrics')`);
    assert.equal(await evaluate(`document.documentElement.dataset.theme`),switched,'Toggled preference must survive a reload');
    assert.equal(await evaluate(`getComputedStyle(document.documentElement).colorScheme`),switched);
    console.log(`${name}: all pages, popup theme toggle and reload persistence checked; no horizontal overflow.`);
  }
  assert.deepEqual(errors, [], 'Browser must not report uncaught exceptions');
} finally {
  socket?.close(); browser.kill();
  await new Promise(resolve => browser.exitCode !== null ? resolve() : browser.once('exit', resolve));
  // Verify this is our isolated temporary profile before recursively removing it.
  assert.equal(resolve(dirname(profile)), resolve(tmpdir())); assert.ok(basename(profile).startsWith('planpilot-headless-'));
  try { await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* Chrome child cleanup can lag on Windows; retain only this isolated temp profile. */ }
}
