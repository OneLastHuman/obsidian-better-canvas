// Run against a dedicated test Vault with this checkout's plugin already loaded.
// node scripts/verify-theme-text-layout.mjs --vault "Test Vault" [--cli "Obsidian.com"]
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const option = name => args[args.indexOf(name) + 1];
if (!args.includes("--vault")) throw new Error("Supply --vault with a dedicated test Vault name.");
const vault = option("--vault");
const cli = args.includes("--cli") ? option("--cli") : "obsidian";
const fixture = `bc-verify-temp/theme-layout-${Date.now()}.canvas`;
const evaluate = code => {
  const output = execFileSync(cli, [`vault=${vault}`, "eval", `code=${code}`], {
    encoding: "utf8", timeout: 30000, windowsHide: true
  }).split("\n").filter(line => !line.startsWith("Received CLI command ")).join("\n").trim().replace(/^=> /, "");
  if (output.startsWith("Error:")) throw new Error(output);
  return JSON.parse(output);
};
const wait = `await document.fonts.ready; await new Promise(r=>setTimeout(r,650));`;
const results = [];
let previous;
try {
  previous = evaluate(`JSON.stringify(app.workspace.getActiveFile()?.path??null)`);
  evaluate(`(async()=>{
    if(document.visibilityState!=='visible') throw new Error('The test Vault window must be visible so native Canvas frames can render.');
    const folder='bc-verify-temp';
    if(!app.vault.getAbstractFileByPath(folder)) await app.vault.createFolder(folder);
    const texts=[
      ['short','\\u5b57'.repeat(8)],
      ['wrapped','\\u5b57'.repeat(73)],
      ['markdown','# A heading\\n\\nA short paragraph.\\n\\n- First item\\n- Second item\\n\\n> A quotation.'],
      ['long-word','abcdefghij'.repeat(10)],
      ['capped','\\u5b57'.repeat(600)]
    ];
    const data={bcTheme:'default',nodes:texts.map(([kind,text],i)=>({
      id:kind+'-'+Date.now(),type:'text',text,x:(i%3)*500,y:Math.floor(i/3)*640,
      width:280,height:140,bcAutoResize:true
    })),edges:[]};
    const file=await app.vault.create(${JSON.stringify(fixture)},JSON.stringify(data));
    await app.workspace.getLeaf(false).openFile(file);
    const c=app.workspace.activeLeaf.view.canvas;
    for(const n of c.nodes.values()) c.select(n);
    c.zoomToSelection();
    ${wait}
    return JSON.stringify(true);
  })()`);
  const themes = [
    ["default", null], ["scrapbook", ".bc-paper-preset"], ["sketch", ".bc-sketch-preset"],
    ["rounded-map", ".bc-rounded-preset"], ["research", ".bc-research-preset"],
    ["soft-notes", ".bc-soft-preset"]
  ];
  for (const [theme, selector] of themes) {
    evaluate(`(async()=>{
      app.commands.executeCommandById('better-canvas:choose-canvas-theme');
      document.querySelector('[data-theme-choice="${theme}"]').click();
      ${wait}
      return JSON.stringify(true);
    })()`);
    let presets = [null];
    if (selector) {
      presets = evaluate(`(()=>{
        const c=app.workspace.activeLeaf.view.canvas;
        for(const n of c.nodes.values()) c.select(n);
        if(!document.querySelector('.bc-node-style-panel')) document.querySelector('.bc-node-style-control-item').click();
        return JSON.stringify([...document.querySelectorAll(${JSON.stringify(selector)})].map(b=>b.dataset.styleOption));
      })()`);
      if (!presets.length) throw new Error(`No presets found for ${theme}`);
    }
    for (const preset of presets) {
      if (preset) evaluate(`(async()=>{
        document.querySelector('[data-style-option="${preset}"]').click();
        ${wait}
        return JSON.stringify(true);
      })()`);
      const rows = evaluate(`(async()=>{
        const c=app.workspace.activeLeaf.view.canvas;
        c.zoomToSelection();
        ${wait}
        return JSON.stringify([...c.nodes.values()].map(n=>{
          const e=n.nodeEl,p=e.querySelector('.markdown-preview-view'),d=n.getData();
          let clipped=0;
          if(d.bcShape==='diamond'&&d.height<560&&p){
            const bounds=e.getBoundingClientRect(),walker=document.createTreeWalker(p,4),range=document.createRange();
            while(walker.nextNode()){
              if(!walker.currentNode.textContent.trim()) continue;
              range.selectNodeContents(walker.currentNode);
              for(const rect of range.getClientRects()){
                if([rect.left,rect.right].some(x=>Math.abs((x-bounds.left)/bounds.width-.5)*2+
                  Math.abs(((rect.top+rect.bottom)/2-bounds.top)/bounds.height-.5)*2>1.02)) clipped++;
              }
            }
          }
          return {kind:n.id.replace(/-\\d+$/,''),width:d.width,height:d.height,auto:d.bcAutoResize,
            alignment:d.bcTextAlign,clipped,domWidth:e.offsetWidth,domHeight:e.offsetHeight,
            scrollHeight:p?.scrollHeight,clientHeight:p?.clientHeight,
            scrollWidth:p?.scrollWidth,clientWidth:p?.clientWidth,
            pass:!!p&&d.bcAutoResize===true&&e.offsetWidth===d.width&&e.offsetHeight===d.height&&clipped===0&&
              d.bcTextAlign===(n.id.startsWith('short-')?'center':'left')&&
              p.scrollWidth<=p.clientWidth+1&&(d.height===560||p.scrollHeight<=p.clientHeight+1)};
        }));
      })()`);
      results.push(...rows.map(row => ({ theme, preset, ...row })));
      const failures = rows.filter(row => !row.pass);
      console.log(`${failures.length ? "FAIL" : "PASS"} ${theme}/${preset ?? "plain"}: ${rows.length - failures.length}/${rows.length}`);
      if (failures.length) console.log(JSON.stringify(failures));
    }
    if (selector) evaluate(`document.querySelector('.bc-node-style-close')?.click(); JSON.stringify(true)`);
  }
} finally {
  if (args.includes("--output")) writeFileSync(option("--output"), JSON.stringify(results, null, 2));
  evaluate(`(async()=>{
    const file=app.vault.getAbstractFileByPath(${JSON.stringify(fixture)});
    const leaf=app.workspace.activeLeaf;
    if(leaf?.view.file?.path===${JSON.stringify(fixture)}) {
      const previous=app.vault.getAbstractFileByPath(${JSON.stringify(previous ?? "")});
      if(previous) await leaf.openFile(previous); else await leaf.setViewState({type:'empty'});
    }
    if(file) await app.vault.delete(file);
    return JSON.stringify(true);
  })()`);
}
const failures = results.filter(row => !row.pass);
console.log(`${results.length - failures.length}/${results.length} rendered layouts passed.`);
if (failures.length) process.exitCode = 1;
