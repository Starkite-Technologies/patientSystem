import { Fragment, useEffect, type ReactNode } from 'react';
import { developerCredit, manual, manualIntro, manualTitle, pilotNote, supportEmail, type HelpBlock, type HelpSectionId } from './help/manual';
import { triageCategories } from './model';

const sectionTitle = (id: HelpSectionId) => manual.find(section => section.id === id)?.title ?? 'Help';

// **bold** is the only inline formatting used in the manual.
function inline(text: string): ReactNode {
  return text.split(/(\*\*[^*]+\*\*)/).map((part, i) => part.startsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : <Fragment key={i}>{part}</Fragment>);
}
function Block({ block }: { block: HelpBlock }) {
  if (typeof block === 'string') return <p>{inline(block)}</p>;
  if ('list' in block) return <ul>{block.list.map((item, i) => <li key={i}>{inline(item)}</li>)}</ul>;
  if ('steps' in block) return <ol>{block.steps.map((item, i) => <li key={i}>{inline(item)}</li>)}</ol>;
  return <p className="help-note">{inline(block.note)}</p>;
}
function jump(id: string) {
  const target = document.getElementById(id);
  // Instant jump: smooth scrolling is unreliable on some devices and can stop short.
  target?.scrollIntoView({ block: 'start' });
  target?.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
}

export function HelpLink({ section, onOpen }: { section: HelpSectionId; onOpen: (section: HelpSectionId) => void }) {
  return <button type="button" className="help-link" aria-label={`Help: ${sectionTitle(section)}`} title={`Help: ${sectionTitle(section)}`} onClick={() => onOpen(section)}>?</button>;
}

// target.at changes on every request, so opening the same section twice still scrolls to it.
export function HelpPage({ target }: { target: { section: HelpSectionId | null; at: number } }) {
  useEffect(() => { requestAnimationFrame(() => target.section ? jump(`help-${target.section}`) : window.scrollTo({ top: 0 })); }, [target]);
  return <article className="help-page" aria-labelledby="help-title">
    <section className="help-card" id="help-top" aria-labelledby="help-quickref">
      <h2 id="help-quickref">Triage colours: quick reference</h2>
      <ul className="triage-ref">{triageCategories.map((category, i) => <li key={category.colour}>
        <span className={`priority priority-${i + 1}`}><span />P{i + 1} · {category.colour}</span>
        <strong>{category.label}</strong>
        <span className="triage-ref-target">{category.target}</span>
      </li>)}</ul>
      <p className="help-small">Overdue: still Waiting or Ready after the target time. <a href="#help-overdue" onClick={e => { e.preventDefault(); jump('help-overdue'); }}>More about overdue flags</a></p>
    </section>
    <header className="help-card help-intro">
      <h2 id="help-title">{manualTitle}</h2>
      <p>{inline(manualIntro)}</p>
      <p className="help-note">{inline(pilotNote)}</p>
    </header>
    <nav className="help-card help-menu" aria-label="Help topics">
      <h2>Topics</h2>
      <ol>{manual.map(s => <li key={s.id}><a href={`#help-${s.id}`} onClick={e => { e.preventDefault(); jump(`help-${s.id}`); }}>{s.title}</a></li>)}</ol>
    </nav>
    {manual.map(s => <section className="help-card help-section" id={`help-${s.id}`} key={s.id} aria-labelledby={`help-${s.id}-title`}>
      <h2 id={`help-${s.id}-title`} tabIndex={-1}>{s.title}</h2>
      {s.blocks.map((block, i) => <Block block={block} key={i} />)}
      <a className="help-top" href="#help-top" onClick={e => { e.preventDefault(); jump('help-top'); }}>Back to topics</a>
    </section>)}
    <footer className="help-credit"><p>{developerCredit}</p><p>Support: <span className="copyable">{supportEmail}</span></p></footer>
  </article>;
}
