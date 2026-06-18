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

export interface Hero {
  versionBadge: string;
  h1: string;
  subcopy: string;
  docsHref: string;
  demo: HeroDemo;
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
  cta: Cta;
  footer: Footer;
  sectionLabels: {
    shift: string;
    pipeline: string;
    tool: string;
    impact: string;
    dashboard: string;
    privacy: string;
    faq: string;
  };
  readDocs: string;
  faqHeading: string;
  manualLabel: string;
  loopengLabel: string;
  privacyCardTitle: string;
  neverGuiltEmphasis: string;
}

export const INSTALL_CMD =
  "curl -fsSL https://raw.githubusercontent.com/issadevs/loopeng/main/install.sh | bash";
export const REPO_URL = "https://github.com/issadevs/loopeng";
export const README_URL = "https://github.com/issadevs/loopeng#readme";
export const GITHUB_STARS_FALLBACK = 677;

const contentEn: SiteContent = {
  nav: [
    { label: "how it works", href: "#how" },
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
  },

  shift: {
    heading: "Redefining engineering productivity.",
    quotes: [
      {
        text: "True productivity isn't typing faster; it's stopping the need to type the same thing twice.",
        author: "Software Engineering Maxim",
        role: "",
      },
      {
        text: "You shouldn't write prompt after prompt. You should orchestrate workflows.",
        author: "Anonymous Senior Engineer",
        role: "",
      },
    ],
    closing:
      "The shift to automated workflows is real — but spotting your patterns takes a toll. loopEng watches out for you and does the heavy lifting.",
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
    shift: "THE SHIFT",
    pipeline: "PIPELINE",
    tool: "THE TOOL",
    impact: "IMPACT",
    dashboard: "DASHBOARD",
    privacy: "PRIVACY",
    faq: "FAQ",
  },

  readDocs: "read the docs →",
  faqHeading: "Frequently asked questions.",
  manualLabel: "manual",
  loopengLabel: "loopEng",
  privacyCardTitle: "redacted before anything moves",
  neverGuiltEmphasis: "Your inbox, your call.",
};

const contentFr: SiteContent = {
  nav: [
    { label: "comment ça marche", href: "#how" },
    { label: "l'outil", href: "#tool" },
    { label: "faq", href: "#faq" },
  ],

  hero: {
    versionBadge: "v0.1.0 · premiers pas",
    h1: "Ce que tu fais à la main devient un outil que tes agents exécutent.",
    subcopy:
      "loopEng observe ta façon de travailler dans le terminal, repère les étapes que tu répètes, et les transforme en outils MCP appelables — pour que tes agents IA les fassent à ta place.",
    docsHref: README_URL,
    demo: {
      line1: "surveillance 5 sessions · démon ✓ · dépense 0/100000",
      line2: "tout est calme — tes outils gèrent",
      proposal: "▶ nouvelle proposition : deploy-staging · confiance 0.9",
    },
  },

  shift: {
    heading: "Redéfinir la productivité des ingénieurs.",
    quotes: [
      {
        text: "La vraie productivité, ce n'est pas taper plus vite ; c'est ne plus avoir à taper deux fois la même chose.",
        author: "Maxime du génie logiciel",
        role: "",
      },
      {
        text: "Vous ne devriez pas écrire invite après invite. Vous devriez orchestrer des workflows.",
        author: "Ingénieur senior anonyme",
        role: "",
      },
    ],
    closing:
      "La transition vers des workflows automatisés est réelle — mais repérer vos schémas demande des efforts. loopEng veille pour vous et fait le travail lourd.",
  },

  pipeline: {
    heading: "D'un réflexe que tu tapes à un outil que tes agents appellent.",
    sub: "loopEng tourne silencieusement en arrière-plan. Voici le chemin de « je continue à faire ça à la main » à un outil que tes agents IA peuvent invoquer.",
    boundary: "tout ici reste sur ta machine",
    outcome: "Ton agent appelle l'outil. loopEng exécute exactement les étapes que tu aurais tapées.",
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
        desc: "Chaque session est compressée et expurgée en un résumé compact — les secrets sont supprimés avant que quoi que ce soit ne quitte ton disque.",
        mockLines: ["[digester] session → résumé", "🔒 4 secrets expurgés"],
      },
      {
        n: "03",
        title: "Détecter",
        desc: "Ton propre claude -p lit les résumés et fait remonter les workflows que tu répètes à la main.",
        mockLines: ["▶ deploy-staging", "vu 4× · confiance 0.9"],
      },
      {
        n: "04",
        title: "Approuver",
        desc: "Tu examines la proposition et approuves celles qui ont du sens. Rien n'est généré sans ton accord.",
        mockLines: ["✓ deploy-staging approuvé"],
      },
      {
        n: "05",
        title: "Outil MCP",
        desc: "loopEng transforme le workflow en un outil MCP appelable — fondé sur les commandes exactes que tu as exécutées — que tes agents invoquent à ta place.",
        mockLines: ["loopeng-tools ▸", "deploy_staging(branch)"],
      },
    ],
  },

  toolAnatomy: {
    heading: "Ton workflow devient un outil que tes agents appellent.",
    sub: "loopEng lit les vraies commandes de tes sessions, déduit les paramètres des parties qui varient, et écrit un outil appelable — fondé sur ce que tu as réellement fait, et jamais exécuté via un shell.",
    observedTitle: "ce que loopEng t'a vu faire",
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
    callTitle: "ton agent, plus tard",
    call: 'deploy_staging(branch: "main")',
    safety: [
      "fondé — uniquement les commandes que tu as exécutées",
      "sans shell — les valeurs ne peuvent rien injecter",
      "ne s'exécute que parce que tu l'as approuvé",
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
      q: "Quelles sont les prérequis ?",
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
    shift: "LE CHANGEMENT",
    pipeline: "PIPELINE",
    tool: "L'OUTIL",
    impact: "IMPACT",
    dashboard: "TABLEAU DE BORD",
    privacy: "CONFIDENTIALITÉ",
    faq: "FAQ",
  },

  readDocs: "lire la doc →",
  faqHeading: "Questions fréquemment posées.",
  manualLabel: "manuel",
  loopengLabel: "loopEng",
  privacyCardTitle: "expurgé avant tout transfert",
  neverGuiltEmphasis: "Votre boîte de réception, votre choix.",
};

export function useContent(): SiteContent {
  const { locale } = useLocale();
  return locale === "fr" ? contentFr : contentEn;
}
