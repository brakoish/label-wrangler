// Just enough DOMParser for reading .xlsx XML in tests (no DOM library in the repo).
function decode(s) { return s.replace(/&(lt|gt|amp|quot|apos|#x?[0-9a-f]+);/gi, (m, e) => ({ lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }[e] ?? (e[1] === 'x' || e[1] === 'X' ? String.fromCodePoint(parseInt(e.slice(2), 16)) : String.fromCodePoint(Number(e.slice(1)))))); }
class Node {
  constructor(name, attrs) { this.name = name; this.attrs = attrs; this.children = []; this.text = ''; }
  get localName() { return this.name.includes(':') ? this.name.split(':')[1] : this.name; }
  getAttribute(n) { return n in this.attrs ? this.attrs[n] : null; }
  getAttributeNS(_ns, n) { const key = Object.keys(this.attrs).find((k) => k.endsWith(':' + n)); return key ? this.attrs[key] : null; }
  get textContent() { return this.text + this.children.map((c) => c.textContent).join(''); }
  getElementsByTagName(tag) {
    const out = [];
    const walk = (node) => { for (const c of node.children) { if (c.name === tag || c.localName === tag) out.push(c); walk(c); } };
    walk(this);
    return out;
  }
}
class DOMParser {
  parseFromString(xml) {
    const root = new Node('#document', {});
    const stack = [root];
    const re = /<\?[^>]*\?>|<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
    let m;
    while ((m = re.exec(xml))) {
      const top = stack[stack.length - 1];
      if (m[1] !== undefined) { top.text += m[1]; continue; }
      if (m[6] !== undefined) { top.text += decode(m[6]); continue; }
      if (!m[3]) continue;
      if (m[2]) { stack.pop(); continue; }
      const attrs = {};
      for (const a of (m[4] || '').matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]] = decode(a[2] ?? a[3]);
      const node = new Node(m[3], attrs);
      top.children.push(node);
      if (!m[5]) stack.push(node);
    }
    return root;
  }
}
module.exports = { DOMParser };
