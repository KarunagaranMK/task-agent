import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowDown, ArrowRight, Check, CircleHelp, Clock3, Database, GitBranch, Layers3, ShieldCheck, Sparkles, Workflow, Zap } from 'lucide-react'

const sections = [
  { id: 'journey', label: 'How it works' },
  { id: 'technology', label: 'Technology' },
  { id: 'ai', label: 'AI and models' },
  { id: 'try', label: 'Try the demo' },
] as const

const journey = [
  { title: 'HR adds a new hire', detail: 'Choose the employee details and joining date. A saved role template supplies the onboarding tasks.', icon: '01' },
  { title: 'The plan is scheduled', detail: 'Dependencies and business days determine when each department can start and how much time remains before Day 1.', icon: '02' },
  { title: 'IT and Facilities do their work', detail: 'Each department sees only its own task queue. Before submitting a finished task, the teammate adds a verification note for HR.', icon: '03' },
  { title: 'HR reviews the handoff', detail: 'HR reads the completed task and its verification notes, then accepts completion or asks the planning agent for an alternative.', icon: '04' },
  { title: 'Readiness stays visible', detail: 'Readiness and completion percentages recalculate after HR accepts each handoff. Accepted work remains visible in the review history.', icon: '05' },
]

export default function GuidePage({ embedded = false }: { embedded?: boolean }) {
  const [active, setActive] = useState<(typeof sections)[number]['id']>('journey')
  const [activeStep, setActiveStep] = useState(0)
  const activeSection = sections.findIndex(section => section.id === active)

  return <main className={`guide-page ${embedded ? 'guide-embedded' : ''}`}>
    <header className="guide-header">
      <div className="guide-brand"><span><Workflow size={19} /></span><strong>Onboard<span>Flow AI</span></strong><small>PROJECT GUIDE</small></div>
      <Link to="/login" className="guide-signin">Open the demo <ArrowRight size={15} /></Link>
    </header>
    <section className="guide-hero">
      <div className="guide-hero-copy">
        <span className="guide-eyebrow"><CircleHelp size={14} /> START HERE</span>
        <h1>One clear view of<br /><em>everyone’s first day.</em></h1>
        <p>OnboardFlow AI coordinates onboarding tasks between HR, IT, and Facilities before a new employee starts.</p>
        <div className="guide-hero-actions"><Link to="/login" className="guide-primary">Explore the demo <ArrowRight size={16} /></Link><span><Clock3 size={14} /> 3 minute walkthrough</span></div>
      </div>
      <div className="guide-flow-card" aria-label="Onboarding process overview">
        <div className="guide-flow-head"><span className="guide-flow-icon"><Workflow size={17} /></span><div><strong>Priya Sharma</strong><small>Data Analyst · starts in 8 business days</small></div><span className="guide-flow-status"><i /> In progress</span></div>
        <div className="guide-flow-track"><span className="guide-track-line" /><div className="guide-flow-node done"><Check size={13} /><span>Plan built</span></div><div className="guide-flow-node done"><Check size={13} /><span>Approvals</span></div><div className="guide-flow-node live"><span className="guide-pulse" /><span>Team tasks</span></div><div className="guide-flow-node"><span className="guide-empty-node" /><span>Ready for Day 1</span></div></div>
        <div className="guide-flow-foot"><span><GitBranch size={13} /> Critical path monitored</span><span><ShieldCheck size={13} /> Decisions audited</span></div>
      </div>
    </section>

    <section className="guide-explainer" aria-label="Project guide">
      <nav className="guide-tabs" aria-label="Guide sections">{sections.map((section, index) => <button key={section.id} className={active === section.id ? 'active' : ''} aria-current={active === section.id ? 'page' : undefined} onClick={() => setActive(section.id)}><span>{String(index + 1).padStart(2, '0')}</span>{section.label}</button>)}</nav>
      <div className="guide-panel" key={active}>
        {active === 'journey' && <>
          <div className="guide-section-title"><span className="guide-eyebrow">THE WORKFLOW</span><h2>What happens, step by step</h2><p>Select a step to see what the user does and what the system handles.</p></div>
          <div className="guide-journey-layout"><div className="guide-step-list" role="tablist" aria-label="Onboarding steps">{journey.map((step, index) => <button key={step.title} role="tab" aria-selected={activeStep === index} className={activeStep === index ? 'active' : ''} onClick={() => setActiveStep(index)}><span>{activeStep > index ? <Check size={14} /> : step.icon}</span><strong>{step.title}</strong><ArrowRight size={14} /></button>)}</div><article className="guide-step-detail" role="tabpanel"><div className="guide-detail-count">STEP {journey[activeStep].icon} <span>OF 05</span></div><h3>{journey[activeStep].title}</h3><p>{journey[activeStep].detail}</p><div className="guide-detail-note"><Sparkles size={15} /><span>People make approvals and complete work. The system coordinates, tracks, and explains progress.</span></div><div className="guide-detail-controls"><button className="guide-secondary" disabled={activeStep === 0} onClick={() => setActiveStep(step => Math.max(0, step - 1))}>Previous</button><button className="guide-primary" onClick={() => activeStep === journey.length - 1 ? setActive('technology') : setActiveStep(step => Math.min(journey.length - 1, step + 1))}>{activeStep === journey.length - 1 ? 'See the technology' : 'Next step'} <ArrowRight size={15} /></button></div></article></div>
        </>}
        {active === 'technology' && <>
          <div className="guide-section-title"><span className="guide-eyebrow">SYSTEM MAP</span><h2>How the pieces fit together</h2><p>The browser handles the experience. The API owns workflow rules and data. Integrations are replaceable adapters.</p></div>
          <div className="guide-architecture"><article><span className="guide-arch-icon"><Layers3 size={18} /></span><small>01 · USER EXPERIENCE</small><h3>React + TypeScript</h3><p>Focused pages for HR, IT, Facilities, and administrators.</p><span className="guide-tech-pills">Vite · Tailwind · TanStack Query · Recharts</span></article><div className="guide-arch-arrow"><ArrowRight size={18} /><small>REST + live events</small></div><article><span className="guide-arch-icon"><Workflow size={18} /></span><small>02 · WORKFLOW API</small><h3>Python 3.11 + FastAPI</h3><p>Validates requests and runs planning, scheduling, monitoring, permissions, and notifications.</p><span className="guide-tech-pills">Pydantic · SQLModel · Alembic · APScheduler</span></article><div className="guide-arch-arrow"><ArrowRight size={18} /><small>MCP tools</small></div><article><span className="guide-arch-icon"><Database size={18} /></span><small>03 · DATA + CONNECTORS</small><h3>SQLite + mock systems</h3><p>Stores demo state and routes ticket or employee lookups through local ITSM and HRIS MCP services.</p><span className="guide-tech-pills">FastMCP stdio · migration history · retry outbox</span></article></div>
          <div className="guide-rules"><div><GitBranch size={16} /><strong>Planner + CPM</strong><span>Builds task dependencies and estimates Day 1 readiness.</span></div><div><Clock3 size={16} /><strong>Monitor</strong><span>Checks for delays and invokes approved recovery rules.</span></div><div><ShieldCheck size={16} /><strong>Governance</strong><span>Role permissions, approvals, and audit history.</span></div><div><Zap size={16} /><strong>Reliability</strong><span>Idempotent dispatch and an outbox for retryable work.</span></div></div>
        </>}
        {active === 'ai' && <>
          <div className="guide-section-title"><span className="guide-eyebrow">MODEL AND AUTOMATION</span><h2>AI suggests. People decide. Rules track.</h2><p>The optional model is Google Gemini 2.5 Flash. The project still works with deterministic fallbacks if the model is unavailable.</p></div>
          <div className="guide-model-grid"><article className="guide-model-card optional"><span className="guide-model-tag"><Sparkles size={13} /> OPTIONAL AI</span><h3>Gemini 2.5 Flash</h3><p>Can suggest role-specific tasks, explain risk, draft notifications, and propose an alternative task when HR requests one. Suggestions are validated and remain pending until HR approves.</p><div className="guide-model-config"><code>GEMINI_MODEL=gemini-2.5-flash</code><span>Configure a key with GEMINI_API_KEY</span></div></article><article className="guide-model-card deterministic"><span className="guide-model-tag"><ShieldCheck size={13} /> DETERMINISTIC</span><h3>Application rules</h3><p>Scheduling, critical-path math, access permissions, HR review, dispatch, retries, stall detection, and readiness tracking run in regular code.</p><div className="guide-model-config"><Check size={14} /><span>Works without an AI provider or API key</span></div></article></div>
          <div className="guide-honesty"><strong>Demo boundaries</strong><span>ITSM and HRIS are mock services, email stays in a local outbox, and readiness experiment results are illustrative simulations.</span></div>
        </>}
        {active === 'try' && <>
          <div className="guide-section-title"><span className="guide-eyebrow">YOUR FIRST WALKTHROUGH</span><h2>Try the project in four moves</h2><p>Start as HR, create a hire, then follow the handoff through the separate IT, Facilities, and HR review pages.</p></div>
          <div className="guide-try-list"><div><span>1</span><p><strong>Register an employee</strong><small>Choose HR, create a hire, and preview the role-specific onboarding tasks.</small></p></div><ArrowDown size={15} /><div><span>2</span><p><strong>Move work to a department</strong><small>IT and Facilities use their separate task queues to verify assigned work.</small></p></div><ArrowDown size={15} /><div><span>3</span><p><strong>Send work to HR</strong><small>When IT or Facilities submits a task, HR reviews its details and verification notes, then accepts it or requests an agent alternative.</small></p></div><ArrowDown size={15} /><div><span>4</span><p><strong>Track the workforce</strong><small>Admin sees registered employees, department readiness, and task progress. HR can see all registered employees and live onboarding completion percentages.</small></p></div></div>
          <div className="guide-try-actions"><Link to="/login" className="guide-primary">Sign in and explore <ArrowRight size={16} /></Link><span>Local run: <code>python run.py</code></span></div>
        </>}
      </div>
      <div className="guide-progress" aria-label={`Section ${activeSection + 1} of ${sections.length}`}><span style={{ width: `${((activeSection + 1) / sections.length) * 100}%` }} /></div>
    </section>
    <footer className="guide-footer"><span>OnboardFlow AI <i>·</i> Project guide</span><span>Built to make the work between teams visible.</span></footer>
  </main>
}
