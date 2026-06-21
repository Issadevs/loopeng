import { useLocale } from "./i18n";

export interface NavLink {
  label: string;
  href: string;
}

export interface HeroDemo {
  line1: string;
  line2: string;
  proposal: string;
}

export interface HeroStat {
  value: string;
  label: string;
}

export interface Hero {
  versionBadge: string;
  h1: string;
  subcopy: string;
  docsHref: string;
  demo: HeroDemo;
  stats: HeroStat[];
}

export interface ShiftQuote {
  text: string;
  author: string;
  role: string;
}

export interface Shift {
  heading: string;
  quotes: ShiftQuote[];
  closing: string;
}

export interface PipelineStep {
  n: string;
  title: string;
  desc: string;
  mockLines: string[];
}

export interface Pipeline {
  heading: string;
  sub: string;
  steps: PipelineStep[];
  boundary: string; // label on the "stays on your machine" enclosure
  outcome: string; // one-line payoff under the flow graph
}

export interface ToolParamHint {
  name: string;
  type: string;
}

export interface ToolAnatomy {
  heading: string;
  sub: string;
  observedTitle: string;
  observed: string[]; // the real command lines loopEng saw, across runs
  toolTitle: string;
  toolName: string;
  toolDesc: string;
  params: ToolParamHint[];
  steps: string[]; // argv joined, with ${param} placeholders
  callTitle: string;
  call: string; // how an agent invokes it later
  safety: string[];
}

export interface ImpactBar {
  label: string;
  before: string;
  after: string;
}

export interface Impact {
  heading: string;
  headingAccent: string;
  bars: ImpactBar[];
  kicker: string;
  footnote: string;
}

export interface DashboardBullet {
  name: string;
  desc: string;
}

export interface Dashboard {
  heading: string;
  command: string;
  bullets: DashboardBullet[];
  subline: string;
}

export interface Privacy {
  heading: string;
  paragraph: string;
  redacted: string[];
  pills: string[];
}

export interface Fable {
  tag: string;
  h3: string;
  paragraph: string;
  example: string;
}

export interface FaqItem {
  q: string;
  a: string;
}

export interface Cta {
  h2: string;
  sub: string;
  subCode: string;
}

export interface InstallStep {
  title: string;
  body: string;
  command: string;
}

export interface InstallFlow {
  heading: string;
  sub: string;
  steps: InstallStep[];
  requirements: string;
  options: string[];
}

export interface OperateCard {
  title: string;
  command: string;
  body: string;
  bullets: string[];
}

export interface Operate {
  heading: string;
  sub: string;
  cards: OperateCard[];
}

export interface FooterLink {
  label: string;
  href: string;
}

export interface Footer {
  copyright: string;
  links: FooterLink[];
  tagline: string;
}

export interface SiteContent {
  nav: NavLink[];
  hero: Hero;
  shift: Shift;
  pipeline: Pipeline;
  toolAnatomy: ToolAnatomy;
  impact: Impact;
  dashboard: Dashboard;
  privacy: Privacy;
  fable: Fable;
  neverGuilt: string;
  faq: FaqItem[];
  installFlow: InstallFlow;
  operate: Operate;
  cta: Cta;
  footer: Footer;
  sectionLabels: {
    install: string;
    shift: string;
    pipeline: string;
    tool: string;
    impact: string;
    dashboard: string;
    privacy: string;
    operate: string;
    faq: string;
  };
  readDocs: string;
  faqHeading: string;
  manualLabel: string;
  loopengLabel: string;
  privacyCardTitle: string;
  neverGuiltEmphasis: string;
  copyLabel: string;
  copiedLabel: string;
}

export const INSTALL_CMD =
  "curl -fsSL https://raw.githubusercontent.com/issadevs/loopeng/main/install.sh | bash";
export const SETUP_CMD = "loopeng setup";
export const REPO_URL = "https://github.com/issadevs/loopeng";
export const README_URL = "https://github.com/issadevs/loopeng#readme";
export const GITHUB_STARS_FALLBACK = 677;

const contentEn: SiteContent = {
  nav: [
    { label: "install", href: "#install" },
    { label: "how it works", href: "#how" },
    { label: "operate", href: "#operate" },
    { label: "the tool", href: "#tool" },
    { label: "faq", href: "#faq" },
  ],

  hero: {
    versionBadge: "v0.1.0 · early software",
    h1: "What you do by hand becomes a tool your agents run.",
    subcopy:
      "loopEng watches how you work in the terminal, spots the steps you keep repeating, and turns them into callable MCP tools — so your AI agents can do them for you.",
    docsHref: README_URL,
    demo: {
      line1: "watching 5 sessions · daemon ✓ · spend 0/100000",
      line2: "all quiet — your tools have it covered",
      proposal: "▶ new proposal: deploy-staging · confidence 0.9",
    },
    stats: [
      { value: "local-first", label: "transcripts stay on your machine" },
      { value: "Claude Code + Codex", label: "session watchers built in" },
      { value: "MCP-ready", label: "approved habits become callable tools" },
    ],
  },

  shift: {
    heading: "The age of prompting is ending.",
    quotes: [
      {
        text: "Don't just prompt. Build the system that does the prompting.",
        author: "Anthropic Engineer",
        role: "shared internally",
      },
      {
        text: "The engineers who win aren't writing better prompts — they're designing systems that never need to ask the same question twice.",
        author: "Software Engineering Maxim",
        role: "",
      },
    ],
    closing:
      "loopEng is that system. It watches how you work, finds the patterns, and turns them into tools your agents call — so the loop runs itself.",
  },

  pipeline: {
    heading: "From a habit you type to a tool your agents call.",
    sub: "loopEng runs quietly in the background. Here's the path from \"I keep doing this by hand\" to a tool your AI agents can invoke.",
    boundary: "everything here stays on your machine",
    outcome: "Your agent calls the tool. loopEng runs the exact steps you would have typed.",
    steps: [
      {
        n: "01",
        title: "Watch",
        desc: "A launchd daemon notices every new Claude Code or Codex session the moment it lands.",
        mockLines: ["[watcher] session claude-code · 13:28"],
      },
      {
        n: "02",
        title: "Digest",
        desc: "Each session is compressed and redacted to a compact digest — secrets stripped before anything leaves your disk.",
        mockLines: ["[digester] session → digest", "🔒 4 secrets redacted"],
      },
      {
        n: "03",
        title: "Detect",
        desc: "Your own claude -p reads the digests and surfaces the workflows you keep repeating by hand.",
        mockLines: ["▶ deploy-staging", "seen 4× · confidence 0.9"],
      },
      {
        n: "04",
        title: "Approve",
        desc: "You review the proposal and approve the ones that make sense. Nothing is generated without your call.",
        mockLines: ["✓ approved deploy-staging"],
      },
      {
        n: "05",
        title: "MCP tool",
        desc: "loopEng turns the workflow into a callable MCP tool — grounded in the exact commands you ran — that your agents invoke for you.",
        mockLines: ["loopeng-tools ▸", "deploy_staging(branch)"],
      },
    ],
  },

  toolAnatomy: {
    heading: "Your workflow becomes a tool your agents call.",
    sub: "loopEng reads the real commands from your sessions, infers parameters from the parts that vary, and writes a callable tool — grounded in what you actually did, and never run through a shell.",
    observedTitle: "what loopEng saw you do",
    observed: [
      "$ git push origin feature-x",
      "$ npm run deploy -- --env staging",
      "$ git push origin feature-y",
      "$ npm run deploy -- --env staging",
    ],
    toolTitle: "tool.json",
    toolName: "deploy_staging",
    toolDesc: "Push a branch and deploy it to staging.",
    params: [{ name: "branch", type: "string" }],
    steps: ["git push origin ${branch}", "npm run deploy -- --env staging"],
    callTitle: "your agent, later",
    call: 'deploy_staging(branch: "main")',
    safety: [
      "grounded — only commands you actually ran",
      "no shell — parameter values can't inject",
      "runs only because you approved it",
    ],
  },

  impact: {
    heading: "Most Claude Code users leave 40–70% on the table.",
    headingAccent: "loopEng finds it.",
    bars: [
      {
        label: "Repetitive overhead",
        before: "90 min/wk",
        after: "10 min/wk",
      },
      {
        label: "Token burn on repeated patterns",
        before: "baseline",
        after: "−20–35%",
      },
      {
        label: "Automatable patterns found / month",
        before: "~0",
        after: "3–5",
      },
    ],
    kicker:
      "A single well-chosen loop replaces 50–200 manual prompts per month.",
    footnote: "Early estimates from initial use — your mileage will vary.",
  },

  dashboard: {
    heading: "One command. Your whole loop operation.",
    command: "$ loopeng",
    bullets: [
      {
        name: "inbox",
        desc: "pending proposals: impact, evidence count, confidence score",
      },
      { name: "loops", desc: "what's installed, trigger kind, target tool" },
      { name: "activity", desc: "everything loopEng did in the background" },
    ],
    subline: "Review, approve, dismiss, or snooze — all from the terminal.",
  },

  installFlow: {
    heading: "Install it once. Start finding loops immediately.",
    sub: "The setup is exactly what the README promises: install the app, run setup, then review proposals from the dashboard.",
    steps: [
      {
        title: "Install",
        body: "Fetch the latest release, build it locally, and put the loopeng binary on your PATH.",
        command: INSTALL_CMD,
      },
      {
        title: "Setup",
        body: "Write config, install the Claude hook, and load the launchd daemon that watches your sessions.",
        command: SETUP_CMD,
      },
      {
        title: "Review",
        body: "Open the terminal dashboard, inspect proposals, approve what deserves to become a loop or MCP tool.",
        command: "loopeng",
      },
    ],
    requirements:
      "Requirements: Node 20+, git, the Claude CLI in your PATH, and macOS.",
    options: [
      "loopeng setup --companion manual",
      "loopeng setup --no-daemon",
      "loopeng scan",
    ],
  },

  privacy: {
    heading: "It never phones home.",
    paragraph:
      "Transcripts stay on your machine. Always. The only LLM calls go through your own claude -p binary.",
    redacted: [
      "api keys, tokens, passwords, bearer tokens",
      "github tokens, aws keys, url credentials",
      "high-entropy strings that look like secrets",
    ],
    pills: ["your own Claude credits", "no separate service", "open source"],
  },

  fable: {
    tag: "BONUS · /fable",
    h3: "Every session, upgraded.",
    paragraph:
      "The installer drops a /fable slash command into every Claude Code session — route any prompt through Claude Fable 5, inline, without switching models.",
    example: "/fable make this component prettier",
  },

  neverGuilt:
    "loopEng may suggest, but it never nags. Ignore, snooze, or dismiss — a quiet tool beats a nagging one. Your inbox, your call.",

  operate: {
    heading: "Use the shell now. Hand control to agents when you're ready.",
    sub: "loopEng exposes the same system through the terminal, a control-surface MCP server, and generated workflow tools.",
    cards: [
      {
        title: "Dashboard",
        command: "loopeng",
        body: "Review proposals, inspect installed loops, and watch background activity in one full-terminal view.",
        bullets: [
          "approve, dismiss, snooze, uninstall",
          "scan on demand or pause the daemon",
          "status and spend visible at a glance",
        ],
      },
      {
        title: "Control MCP",
        command: "loopeng mcp-register",
        body: "Let Claude Code call loopEng directly through tools like proposals_list, scan, loops_list, and pipeline_run.",
        bullets: [
          "registers the loopEng control surface",
          "works with stdio MCP",
          "agents can approve proposals and run pipelines",
        ],
      },
      {
        title: "Pipelines & tools",
        command:
          'loopeng define ship-feature --describe "implement, test until green, open a PR"',
        body: "Capture phased work, gate each step, and expose approved repeated workflows as callable MCP tools on loopeng-tools.",
        bullets: [
          "resume stopped phase runs",
          "gate commands must pass before advancing",
          "tool steps run as argv arrays, never through a shell",
        ],
      },
    ],
  },

  faq: [
    {
      q: "What is loopEng?",
      a: "A local meta-agent that runs in your terminal alongside Claude Code. It watches your sessions, spots work you keep doing by hand, and turns it into callable MCP tools your AI agents can run for you. You approve; the tool exists.",
    },
    {
      q: "How is a workflow turned into an MCP tool?",
      a: "When you approve a proposal, loopEng resolves the real commands from your sessions, infers the parameters from what varied across runs, and writes a tool.json. The loopeng-tools MCP server then exposes it as a callable tool. A deterministic check rejects any command you were never observed running.",
    },
    {
      q: "Is it safe to let agents run these tools?",
      a: "Yes, by design. A tool only exists because you approved the proposal it came from. Steps run as argv arrays through execFile — never a shell — each with a timeout and bounded output, so a parameter like 'main; rm -rf /' is passed as one literal argument, never interpreted.",
    },
    {
      q: "Who is it for?",
      a: "Developers who want to graduate from manual prompting to loop orchestration but don't know where to start — and anyone who wants to systematically cut the overhead of repetitive prompting.",
    },
    {
      q: "Does it send my code anywhere?",
      a: "No. Transcripts stay on your machine. Digests are redacted of secrets and sent only to your own claude -p process. loopEng never contacts an external service.",
    },
    {
      q: "Do I need a subscription or API key?",
      a: "No subscription. loopEng uses your existing Claude Code CLI and your own Claude credits. No separate service, no cloud component.",
    },
    {
      q: "What does an installed loop look like?",
      a: "A bundle at ~/.loopeng/bundles/<id>/: loop.md (instructions), trigger.json (schedule/hook/manual), manifest.json (evidence + every path installed), tool.json (the callable MCP tool, when one could be synthesized), and a state/ dir. The manifest makes uninstall exact.",
    },
    {
      q: "Is it open source?",
      a: "Yes. loopEng is free and open source. Clone it, read it, contribute on GitHub.",
    },
    {
      q: "What are the requirements?",
      a: "Node ≥ 20, git, the Claude Code CLI (claude) in your PATH, and macOS. Windows/Linux daemon support is on the roadmap.",
    },
  ],

  cta: {
    h2: "Ready to write your first loop?",
    sub: "then ",
    subCode: "loopeng setup",
  },

  footer: {
    copyright: "© 2026 loopEng",
    links: [
      { label: "GitHub", href: REPO_URL },
      { label: "README", href: README_URL },
      { label: "/fable", href: "#fable" },
    ],
    tagline:
      "Created for developers who prefer automated workflows over re-typing the same commands.",
  },

  sectionLabels: {
    install: "INSTALL",
    shift: "THE SHIFT",
    pipeline: "PIPELINE",
    tool: "THE TOOL",
    impact: "IMPACT",
    dashboard: "DASHBOARD",
    privacy: "PRIVACY",
    operate: "OPERATE",
    faq: "FAQ",
  },

  readDocs: "read the docs →",
  faqHeading: "Frequently asked questions.",
  manualLabel: "manual",
  loopengLabel: "loopEng",
  privacyCardTitle: "redacted before anything moves",
  neverGuiltEmphasis: "Your inbox, your call.",
  copyLabel: "copy",
  copiedLabel: "copied ✓",
};

const contentFr: SiteContent = {
  nav: [
    { label: "installation", href: "#install" },
    { label: "comment ça marche", href: "#how" },
    { label: "utilisation", href: "#operate" },
    { label: "l'outil", href: "#tool" },
    { label: "faq", href: "#faq" },
  ],

  hero: {
    versionBadge: "v0.1.0 · premiers pas",
    h1: "Ce que vous faites à la main devient un outil que vos agents exécutent.",
    subcopy:
      "loopEng observe votre façon de travailler dans le terminal, repère les étapes que vous répétez, et les transforme en outils MCP appelables — pour que vos agents IA les fassent à votre place.",
    docsHref: README_URL,
    demo: {
      line1: "surveillance 5 sessions · démon ✓ · dépense 0/100000",
      line2: "tout est calme — vos outils gèrent",
      proposal: "▶ nouvelle proposition : deploy-staging · confiance 0.9",
    },
    stats: [
      { value: "local-first", label: "les transcriptions restent sur votre machine" },
      { value: "Claude Code + Codex", label: "surveillance des sessions incluse" },
      { value: "MCP-ready", label: "les habitudes approuvées deviennent des outils" },
    ],
  },

  shift: {
    heading: "L'ère du prompting touche à sa fin.",
    quotes: [
      {
        text: "Ne promptez pas. Construisez le système qui prompte à votre place.",
        author: "Ingénieur chez Anthropic",
        role: "partagé en interne",
      },
      {
        text: "Les ingénieurs qui gagnent n'écrivent pas de meilleurs prompts — ils conçoivent des systèmes qui n'ont jamais besoin de poser deux fois la même question.",
        author: "Maxime du génie logiciel",
        role: "",
      },
    ],
    closing:
      "loopEng est ce système. Il observe votre façon de travailler, repère les schémas, et les transforme en outils que vos agents appellent — pour que la boucle tourne seule.",
  },

  pipeline: {
    heading: "D'un réflexe que vous tapez à un outil que vos agents appellent.",
    sub: "loopEng tourne silencieusement en arrière-plan. Voici le chemin de « je continue à faire ça à la main » à un outil que vos agents IA peuvent invoquer.",
    boundary: "tout ici reste sur votre machine",
    outcome: "Votre agent appelle l'outil. loopEng exécute exactement les étapes que vous auriez tapées.",
    steps: [
      {
        n: "01",
        title: "Observer",
        desc: "Un démon launchd détecte chaque nouvelle session Claude Code ou Codex dès son arrivée.",
        mockLines: ["[watcher] session claude-code · 13:28"],
      },
      {
        n: "02",
        title: "Digérer",
        desc: "Chaque session est compressée et expurgée en un résumé compact — les secrets sont supprimés avant que quoi que ce soit ne quitte votre disque.",
        mockLines: ["[digester] session → résumé", "🔒 4 secrets expurgés"],
      },
      {
        n: "03",
        title: "Détecter",
        desc: "Votre propre claude -p lit les résumés et fait remonter les workflows que vous répétez à la main.",
        mockLines: ["▶ deploy-staging", "vu 4× · confiance 0.9"],
      },
      {
        n: "04",
        title: "Approuver",
        desc: "Vous examinez la proposition et approuvez celles qui ont du sens. Rien n'est généré sans votre accord.",
        mockLines: ["✓ deploy-staging approuvé"],
      },
      {
        n: "05",
        title: "Outil MCP",
        desc: "loopEng transforme le workflow en un outil MCP appelable — fondé sur les commandes exactes que vous avez exécutées — que vos agents invoquent à votre place.",
        mockLines: ["loopeng-tools ▸", "deploy_staging(branch)"],
      },
    ],
  },

  toolAnatomy: {
    heading: "Votre workflow devient un outil que vos agents appellent.",
    sub: "loopEng lit les vraies commandes de vos sessions, déduit les paramètres des parties qui varient, et écrit un outil appelable — fondé sur ce que vous avez réellement fait, et jamais exécuté via un shell.",
    observedTitle: "ce que loopEng vous a vu faire",
    observed: [
      "$ git push origin feature-x",
      "$ npm run deploy -- --env staging",
      "$ git push origin feature-y",
      "$ npm run deploy -- --env staging",
    ],
    toolTitle: "tool.json",
    toolName: "deploy_staging",
    toolDesc: "Pousser une branche et la déployer en staging.",
    params: [{ name: "branch", type: "string" }],
    steps: ["git push origin ${branch}", "npm run deploy -- --env staging"],
    callTitle: "votre agent, plus tard",
    call: 'deploy_staging(branch: "main")',
    safety: [
      "fondé — uniquement les commandes que vous avez exécutées",
      "sans shell — les valeurs ne peuvent rien injecter",
      "ne s'exécute que parce que vous l'avez approuvé",
    ],
  },

  impact: {
    heading: "La plupart des utilisateurs de Claude Code laissent 40 à 70 % sur la table.",
    headingAccent: "loopEng les récupère.",
    bars: [
      {
        label: "Tâches répétitives",
        before: "90 min/sem",
        after: "10 min/sem",
      },
      {
        label: "Consommation de tokens sur les schémas répétés",
        before: "référence",
        after: "−20–35%",
      },
      {
        label: "Schémas automatisables trouvés / mois",
        before: "~0",
        after: "3–5",
      },
    ],
    kicker:
      "Une seule boucle bien choisie remplace 50 à 200 invites manuelles par mois.",
    footnote: "Premières estimations issues de l'utilisation initiale — les résultats peuvent varier.",
  },

  dashboard: {
    heading: "Une commande. Toute votre boucle opérationnelle.",
    command: "$ loopeng",
    bullets: [
      {
        name: "boîte de réception",
        desc: "propositions en attente : impact, nombre de preuves, score de confiance",
      },
      { name: "boucles", desc: "ce qui est installé, type de déclencheur, outil cible" },
      { name: "activité", desc: "tout ce que loopEng a fait en arrière-plan" },
    ],
    subline: "Examinez, approuvez, rejetez ou reportez — tout depuis le terminal.",
  },

  installFlow: {
    heading: "Installez-le une fois. Commencez à repérer des boucles immédiatement.",
    sub: "La mise en route suit exactement le README : installer l'app, lancer le setup, puis examiner les propositions dans le dashboard.",
    steps: [
      {
        title: "Installer",
        body: "Récupère la dernière version, la build en local, puis place le binaire loopeng dans votre PATH.",
        command: INSTALL_CMD,
      },
      {
        title: "Configurer",
        body: "Écrit la configuration, installe le hook Claude et charge le démon launchd qui observe vos sessions.",
        command: SETUP_CMD,
      },
      {
        title: "Examiner",
        body: "Ouvrez le dashboard terminal, inspectez les propositions, puis approuvez celles qui méritent de devenir une loop ou un outil MCP.",
        command: "loopeng",
      },
    ],
    requirements:
      "Prérequis : Node 20+, git, la CLI Claude dans votre PATH, et macOS.",
    options: [
      "loopeng setup --companion manual",
      "loopeng setup --no-daemon",
      "loopeng scan",
    ],
  },

  privacy: {
    heading: "Jamais de connexion externe.",
    paragraph:
      "Les transcriptions restent sur votre machine. Toujours. Les seuls appels LLM passent par votre propre binaire claude -p.",
    redacted: [
      "clés api, jetons, mots de passe, jetons bearer",
      "jetons github, clés aws, identifiants url",
      "chaînes à haute entropie qui ressemblent à des secrets",
    ],
    pills: ["vos propres crédits Claude", "aucun service séparé", "open source"],
  },

  fable: {
    tag: "BONUS · /fable",
    h3: "Chaque session, améliorée.",
    paragraph:
      "L'installateur dépose une commande slash /fable dans chaque session Claude Code — acheminez n'importe quelle invite via Claude Fable 5, en ligne, sans changer de modèle.",
    example: "/fable rends ce composant plus joli",
  },

  neverGuilt:
    "loopEng peut suggérer, mais il ne harcèle jamais. Ignorez, reportez ou rejetez — un outil discret vaut mieux qu'un outil insistant. Votre boîte de réception, votre choix.",

  operate: {
    heading: "Utilisez le shell tout de suite. Laissez les agents piloter ensuite.",
    sub: "loopEng expose le même système via le terminal, un serveur MCP de contrôle et des outils de workflow générés.",
    cards: [
      {
        title: "Dashboard",
        command: "loopeng",
        body: "Examinez les propositions, inspectez les loops installées et suivez l'activité de fond dans une seule vue terminal.",
        bullets: [
          "approuver, rejeter, reporter, désinstaller",
          "scanner à la demande ou mettre le démon en pause",
          "statut et consommation visibles d'un coup d'œil",
        ],
      },
      {
        title: "MCP de contrôle",
        command: "loopeng mcp-register",
        body: "Permet à Claude Code d'appeler loopEng directement via des outils comme proposals_list, scan, loops_list et pipeline_run.",
        bullets: [
          "enregistre la surface de contrôle loopEng",
          "fonctionne en MCP stdio",
          "les agents peuvent approuver des propositions et lancer des pipelines",
        ],
      },
      {
        title: "Pipelines et outils",
        command:
          'loopeng define ship-feature --describe "implémente, teste jusqu’au vert, ouvre une PR"',
        body: "Capturez un travail en phases, validez chaque étape, puis exposez les workflows approuvés comme outils MCP appelables sur loopeng-tools.",
        bullets: [
          "reprend les exécutions arrêtées à la bonne phase",
          "les commandes de gate doivent réussir avant d'avancer",
          "les étapes d'outil s'exécutent en argv, jamais via un shell",
        ],
      },
    ],
  },

  faq: [
    {
      q: "Qu'est-ce que loopEng ?",
      a: "Un méta-agent local qui tourne dans votre terminal aux côtés de Claude Code. Il observe vos sessions, repère les tâches que vous répétez à la main et les transforme en outils MCP appelables que vos agents IA exécutent à votre place. Vous approuvez ; l'outil existe.",
    },
    {
      q: "Comment un workflow devient-il un outil MCP ?",
      a: "Quand vous approuvez une proposition, loopEng résout les vraies commandes de vos sessions, déduit les paramètres de ce qui a varié d'une exécution à l'autre, et écrit un tool.json. Le serveur MCP loopeng-tools l'expose alors comme un outil appelable. Une vérification déterministe rejette toute commande que vous n'avez jamais été observé en train d'exécuter.",
    },
    {
      q: "Est-ce sûr de laisser des agents exécuter ces outils ?",
      a: "Oui, par conception. Un outil n'existe que parce que vous avez approuvé la proposition dont il provient. Les étapes s'exécutent comme des tableaux argv via execFile — jamais un shell — chacune avec un délai et une sortie bornée, donc un paramètre comme 'main; rm -rf /' est passé comme un seul argument littéral, jamais interprété.",
    },
    {
      q: "À qui cela s'adresse-t-il ?",
      a: "Aux développeurs qui veulent passer du prompting manuel à l'orchestration de boucles mais ne savent pas par où commencer — et à tous ceux qui souhaitent réduire systématiquement la charge du prompting répétitif.",
    },
    {
      q: "Est-ce que ça envoie mon code quelque part ?",
      a: "Non. Les transcriptions restent sur votre machine. Les résumés sont expurgés des secrets et envoyés uniquement à votre propre processus claude -p. loopEng ne contacte jamais de service externe.",
    },
    {
      q: "Ai-je besoin d'un abonnement ou d'une clé API ?",
      a: "Aucun abonnement. loopEng utilise votre CLI Claude Code existante et vos propres crédits Claude. Pas de service séparé, pas de composant cloud.",
    },
    {
      q: "À quoi ressemble une boucle installée ?",
      a: "Un ensemble dans ~/.loopeng/bundles/<id>/ : loop.md (instructions), trigger.json (planification/déclencheur/manuel), manifest.json (preuves + tous les chemins installés), tool.json (l'outil MCP appelable, quand il peut être synthétisé) et un dossier state/. Le manifeste rend la désinstallation précise.",
    },
    {
      q: "Est-ce open source ?",
      a: "Oui. loopEng est gratuit et open source. Clonez-le, lisez-le, contribuez sur GitHub.",
    },
    {
      q: "Quels sont les prérequis ?",
      a: "Node ≥ 20, git, la CLI Claude Code (claude) dans votre PATH, et macOS. La prise en charge des démons Windows/Linux est sur la feuille de route.",
    },
  ],

  cta: {
    h2: "Prêt à écrire votre première boucle ?",
    sub: "puis ",
    subCode: "loopeng setup",
  },

  footer: {
    copyright: "© 2026 loopEng",
    links: [
      { label: "GitHub", href: REPO_URL },
      { label: "README", href: README_URL },
      { label: "/fable", href: "#fable" },
    ],
    tagline:
      "Créé pour les développeurs qui préfèrent les workflows automatisés aux commandes retapées.",
  },

  sectionLabels: {
    install: "INSTALLATION",
    shift: "LE CHANGEMENT",
    pipeline: "PIPELINE",
    tool: "L'OUTIL",
    impact: "IMPACT",
    dashboard: "TABLEAU DE BORD",
    privacy: "CONFIDENTIALITÉ",
    operate: "UTILISATION",
    faq: "FAQ",
  },

  readDocs: "lire la doc →",
  faqHeading: "Questions fréquemment posées.",
  manualLabel: "manuel",
  loopengLabel: "loopEng",
  privacyCardTitle: "expurgé avant tout transfert",
  neverGuiltEmphasis: "Votre boîte de réception, votre choix.",
  copyLabel: "copier",
  copiedLabel: "copié ✓",
};

export function useContent(): SiteContent {
  const { locale } = useLocale();
  return locale === "fr" ? contentFr : contentEn;
}
