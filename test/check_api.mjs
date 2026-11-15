const WIKIS = [
  { label: "ja.wikipedia.org", base: "https://ja.wikipedia.org" },
  { label: "shikabaton.miraheze.org (default)", base: "https://shikabaton.miraheze.org" }
];

const USER_AGENT = "WikiExplorerCheck/1.0 (local verification)";

function apiUrl(base, params) {
  const query = new URLSearchParams({
    action: "query",
    format: "json",
    formatversion: "2",
    origin: "*",
    ...params
  });
  return `${base}/w/api.php?${query}`;
}

function parseUrl(base, page) {
  const query = new URLSearchParams({
    action: "parse",
    page,
    prop: "text|displaytitle",
    format: "json",
    formatversion: "2",
    origin: "*"
  });
  return `${base}/w/api.php?${query}`;
}

async function getJson(url) {
  const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`JSON ではありません (HTTP ${response.status}): ${text.slice(0, 120)}`);
  }
  return { response, data };
}

function assertNoError(response, data, name) {
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
  if (data.error) throw new Error(`${name}: API error ${data.error.code}: ${data.error.info}`);
}

async function checkWiki(wiki) {
  const lines = [];

  const siteinfo = await getJson(apiUrl(wiki.base, { meta: "siteinfo", siprop: "general" }));
  assertNoError(siteinfo.response, siteinfo.data, `${wiki.label} siteinfo`);
  const siteName = siteinfo.data.query?.general?.sitename;
  if (!siteName) throw new Error(`${wiki.label} siteinfo: sitename がありません`);
  lines.push(`  siteinfo       OK  (${siteName})`);

  const changes = await getJson(apiUrl(wiki.base, {
    list: "recentchanges",
    rcprop: "title|timestamp|user",
    rclimit: "20"
  }));
  assertNoError(changes.response, changes.data, `${wiki.label} recentchanges`);
  const recent = changes.data.query?.recentchanges || [];
  if (!recent.length) throw new Error(`${wiki.label} recentchanges: 空です`);
  lines.push(`  recentchanges  OK  (${recent.length} 件)`);

  const categories = await getJson(apiUrl(wiki.base, { list: "allcategories", aclimit: "30" }));
  assertNoError(categories.response, categories.data, `${wiki.label} allcategories`);
  const allCategories = categories.data.query?.allcategories || [];
  if (!allCategories.length) throw new Error(`${wiki.label} allcategories: 空です`);
  lines.push(`  allcategories  OK  (${allCategories.length} 件)`);

  const titles = recent.map(change => change.title);
  const candidates = [
    ...titles.filter(title => !title.includes(":")),
    ...titles
  ].slice(0, 8);
  let parsed = null;
  let parseError = null;
  for (const title of candidates) {
    try {
      const result = await getJson(parseUrl(wiki.base, title));
      assertNoError(result.response, result.data, `${wiki.label} parse`);
      if (result.data.parse?.text === undefined) throw new Error("parse.text がありません");
      parsed = title;
      break;
    } catch (error) {
      parseError = error;
    }
  }
  if (!parsed) throw new Error(`${wiki.label} parse: ${parseError?.message || "候補がありません"}`);
  lines.push(`  parse          OK  (${parsed})`);

  return lines;
}

let failures = 0;
for (const wiki of WIKIS) {
  try {
    const lines = await checkWiki(wiki);
    console.log(`[PASS] ${wiki.label}  ${wiki.base}/w/api.php`);
    for (const line of lines) console.log(line);
  } catch (error) {
    failures += 1;
    console.log(`[FAIL] ${wiki.label}`);
    console.log(`  ${error.message}`);
  }
}

console.log(failures ? `\n${failures} wiki(s) failed.` : "\nAll checks passed.");
process.exit(failures ? 1 : 0);
