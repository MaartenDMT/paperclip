import {
  isPluginOperationIssueOriginKind,
  type IssueCompletionEvidence,
  type IssueOriginKind,
  type IssueStatus,
  type IssueWorkProduct,
} from "@paperclipai/shared";

const CODE_CHANGE_WORK_PRODUCT_TYPES = new Set(["branch", "commit"]);
const COMPLETION_WORK_PRODUCT_TYPES = new Set(["pull_request", "preview_url", "runtime_service", "artifact"]);
const COMPLETED_WORK_PRODUCT_STATUSES = new Set(["approved", "merged", "closed", "archived"]);
const OPEN_PULL_REQUEST_STATUSES = new Set(["active", "ready_for_review", "draft", "changes_requested"]);
const OPERATIONAL_ORIGIN_KINDS = new Set([
  "stale_active_run_evaluation",
  "harness_liveness_escalation",
  "issue_productivity_review",
  "stranded_issue_recovery",
]);

type IssueCompletionInput = {
  status: IssueStatus | string;
  title?: string | null;
  description?: string | null;
  originKind?: IssueOriginKind | string | null;
};

function isCompletedWorkProduct(product: IssueWorkProduct) {
  return product.reviewState === "approved" || COMPLETED_WORK_PRODUCT_STATUSES.has(product.status);
}

function isOpenPullRequest(product: IssueWorkProduct) {
  return product.type === "pull_request" && OPEN_PULL_REQUEST_STATUSES.has(product.status);
}

function isOperationalOrigin(originKind: string | null | undefined) {
  return Boolean(
    originKind &&
      (OPERATIONAL_ORIGIN_KINDS.has(originKind) || isPluginOperationIssueOriginKind(originKind))
  );
}

const MANUAL_OPERATIONAL_COMPLETION_PATTERNS: RegExp[] = [
  /\b(restor(?:e|ed|ing)|repair(?:ed|ing)?|recover(?:ed|ing)?|clean(?:ed|ing)?|recreate(?:d|ing)?|bootstrap(?:ped|ping)?|reset(?:ting)?)\b.{0,90}\b(worktree|checkout|workspace|runtime|dev server|pnpm dev|node_modules|vite cache|dependency install)\b/,
  /\b(worktree|checkout|workspace|runtime|dev server|pnpm dev|node_modules|vite cache|dependency install)\b.{0,90}\b(restor(?:e|ed|ing)|repair(?:ed|ing)?|recover(?:ed|ing)?|clean(?:ed|ing)?|recreate(?:d|ing)?|bootstrap(?:ped|ping)?|reset(?:ting)?)\b/,
  /\b(verif(?:y|ied|ication)|confirm(?:ed|ing)?|validate(?:d|ing)?|smoke[-\s]?test(?:ed|ing)?|qa evidence|record(?:ed|ing)? qa)\b.{0,90}\b(production|prod|deployment|deploy(?:ed|ment)?|runtime|behavior|health|preview)\b/,
  /\b(production|prod|deployment|deploy(?:ed|ment)?|runtime|behavior|health|preview)\b.{0,90}\b(verif(?:y|ied|ication)|confirm(?:ed|ing)?|validate(?:d|ing)?|smoke[-\s]?test(?:ed|ing)?|qa evidence|record(?:ed|ing)? qa)\b/,
  /\b(clear(?:ed|ing)?|resolve(?:d|ing)?|close(?:d|ing)?|review(?:ed|ing)?|triage(?:d|ing)?|rout(?:e|ed|ing)|delegat(?:e|ed|ing)|handoff|hand off|reassign(?:ed|ing)?)\b.{0,90}\b(stale|blocker|blocked|stale[-\s]?run|run review|productivity review|recovery|agent|owner|assignment)\b/,
  /\b(stale|blocker|blocked|stale[-\s]?run|run review|productivity review|recovery|agent|owner|assignment)\b.{0,90}\b(clear(?:ed|ing)?|resolve(?:d|ing)?|close(?:d|ing)?|review(?:ed|ing)?|triage(?:d|ing)?|rout(?:e|ed|ing)|delegat(?:e|ed|ing)|handoff|hand off|reassign(?:ed|ing)?)\b/,
  /\b(confirm(?:ed|ing)?|verify(?:ing|ied)?|validate(?:d|ing)?)\b.{0,90}\b(merged pull request|merged pr|pr deployed|pull request deployed|merge deployed)\b/,
  /\b(workflow correction|unblock(?:ed|ing)?|reset(?:ting)?|wake|woke)\b.{0,120}\b(issue|agent|owner|assignee|workflow|lane|state|execution path|evidence path|board)\b/,
  /\b(restore(?:d|ing)?|recover(?:ed|ing)?|repair(?:ed|ing)?)\b.{0,120}\b(verification execution path|frontend verification|execution path|evidence path|no-live-execution|process_lost|blocked-without-edge)\b/,
  /\b(analytics verification|qa validation|qa verification|production testing|testing)\b.{0,120}\b(author pages|production|analytics|funnel|events|run window)\b/,
  /\b(railway|cloudflare|token|credential|credentials|api auth|invalid_grant|cache purge|edge cache|deploy lane|deployment evidence)\b.{0,120}\b(block(?:s|ed|ing)?|restore(?:d|ing)?|reset(?:ting)?|rotate(?:d|ing)?|purge(?:d|ing)?|auth|unblock(?:ed|ing)?|evidence)\b/,
  /\b(block(?:s|ed|ing)?|restore(?:d|ing)?|reset(?:ting)?|rotate(?:d|ing)?|purge(?:d|ing)?|auth|unblock(?:ed|ing)?|evidence)\b.{0,120}\b(railway|cloudflare|token|credential|credentials|api auth|invalid_grant|cache purge|edge cache|deploy lane|deployment evidence)\b/,
];

const CODE_SHIPPING_COMPLETION_PATTERNS: RegExp[] = [
  /\b(fix(?:ed|ing)?|re[-\s]?fix(?:ed|ing)?|implement(?:ed|ing)?|refactor(?:ed|ing)?|patch(?:ed|ing)?|wire(?:d|ing)?|integrat(?:e|ed|ing)|build(?:ing|t)?|add(?:ed|ing)?|update(?:d|ing)?|change(?:d|ing)?|ship(?:ped|ping)?|show(?:ed|ing)?|expose(?:d|ing)?|make|clear|collapse(?:d|ing)?)\b.{0,120}\b(api|endpoint|route|handler|controller|schema|migration|database|db|server|backend|frontend|ui|component|auth|login|signup|runtime|adapter|service|worker|hook|cache|bug|error|500|test|build|deploy|page|surface|nav|navigation|filter|button|badge|metadata|seo|og|cover|image|dashboard|breadcrumb|settings|catalog|book grid|discover|search|interactive|hero|tap target)\b/,
  /\b(api|endpoint|route|handler|controller|schema|migration|database|db|server|backend|frontend|ui|component|auth|login|signup|runtime|adapter|service|worker|hook|cache|bug|error|500|test|build|deploy|page|surface|nav|navigation|filter|button|badge|metadata|seo|og|cover|image|dashboard|breadcrumb|settings|catalog|book grid|discover|search|interactive|hero|tap target)\b.{0,120}\b(fix(?:ed|ing)?|re[-\s]?fix(?:ed|ing)?|implement(?:ed|ing)?|refactor(?:ed|ing)?|patch(?:ed|ing)?|wire(?:d|ing)?|integrat(?:e|ed|ing)|build(?:ing|t)?|add(?:ed|ing)?|update(?:d|ing)?|change(?:d|ing)?|ship(?:ped|ping)?|show(?:ed|ing)?|expose(?:d|ing)?|make|clear|collapse(?:d|ing)?)\b/,
  /\b(regression|crash|exception|traceback|failing test|typecheck|compile error|build error|runtime error|server error|login 500|auth 500|empty state|non-clickable|not showing|not working|broken cover|broken image|below 44px|unreachable|misleads)\b/,
];

const NON_CODE_COMPLETION_PATTERNS: RegExp[] = [
  /\b(write|wrote|draft(?:ed|ing)?|copy(?:write|writing)?|edit(?:ed|ing)?|publish(?:ed|ing)?|author(?:ed|ing)?|outline(?:d|ing)?|script(?:ed|ing)?|storyboard(?:ed|ing)?)\b.{0,110}\b(copy|cta|email|blog|post|article|newsletter|campaign|community update|content|story|novel|chapter|scene|fiction|brief|script|storyboard|visual prompt|prompt)\b/,
  /\b(copy|cta|email|blog|post|article|newsletter|campaign|community update|content|story|novel|chapter|scene|fiction|brief|script|storyboard|visual prompt|prompt)\b.{0,110}\b(write|wrote|draft(?:ed|ing)?|copy(?:write|writing)?|edit(?:ed|ing)?|publish(?:ed|ing)?|author(?:ed|ing)?|outline(?:d|ing)?|script(?:ed|ing)?|storyboard(?:ed|ing)?)\b/,
  /\b(approve|approved|approval|review(?:ed|ing)?|validate(?:d|ing)?|audit(?:ed|ing)?|triage(?:d|ing)?|classif(?:y|ied|ication)|support triage|certification|training|sla baseline|research(?:ed|ing)?|analysis|analyz(?:e|ed|ing))\b.{0,110}\b(copy|content|story|novel|fiction|marketing|campaign|support|feedback|reader|creator|customer|launch|brief|template|open question|go[-\s]?live|sla|training)\b/,
  /\b(copy|content|story|novel|fiction|marketing|campaign|support|feedback|reader|creator|customer|launch|brief|template|open question|go[-\s]?live|sla|training)\b.{0,110}\b(approve|approved|approval|review(?:ed|ing)?|validate(?:d|ing)?|audit(?:ed|ing)?|triage(?:d|ing)?|classif(?:y|ied|ication)|support triage|certification|training|sla baseline|research(?:ed|ing)?|analysis|analyz(?:e|ed|ing))\b/,
  /\b(interaction spec|implementation[-\s]?ready spec|requirements|measurement plan|fallback plan|baseline snapshot|plot grid|continuation plan|chapter[-\s]?beat plan|character architect|plot architect|architect gate|fiction director|qa audit|ux audit|ux finding)\b/,
  /\b(spec|requirements|plan|gate|audit|finding)\b.{0,100}\b(discover|search|author|reader|publication|book|cover|metadata|report flow|fallback|crawlable|conversion|dashboard|workflow|analytics|measurement)\b/,
  /\b(discover|search|author|reader|publication|book|cover|metadata|report flow|fallback|crawlable|conversion|dashboard|workflow|analytics|measurement)\b.{0,100}\b(spec|requirements|plan|gate|audit|finding)\b/,
  /\b(storybook|community updates?|content department|author ux|component consistency|workflow ergonomics|graphic novel workflow design optimization|seo scores|blog|admin called|accounts|environment elements|storage system|how are .{0,80} saved)\b/,
  /\b(continuation follow-up|catalog qa follow-up|track .{0,80} follow-up|change title|readersbase novels)\b/,
];

function isManualOperationalCompletion(issue: IssueCompletionInput) {
  if (isOperationalOrigin(issue.originKind ?? null)) return false;
  const text = `${issue.title ?? ""}\n${issue.description ?? ""}`.toLowerCase().replace(/\s+/g, " ").trim();
  if (!text) return false;
  return MANUAL_OPERATIONAL_COMPLETION_PATTERNS.some((pattern) => pattern.test(text));
}

function isLikelyCodeShippingCompletion(issue: IssueCompletionInput) {
  if (isOperationalOrigin(issue.originKind ?? null)) return false;
  const text = `${issue.title ?? ""}\n${issue.description ?? ""}`.toLowerCase().replace(/\s+/g, " ").trim();
  if (!text) return false;
  return CODE_SHIPPING_COMPLETION_PATTERNS.some((pattern) => pattern.test(text));
}

function isLikelyNonCodeCompletion(issue: IssueCompletionInput) {
  if (isOperationalOrigin(issue.originKind ?? null)) return false;
  const text = `${issue.title ?? ""}\n${issue.description ?? ""}`.toLowerCase().replace(/\s+/g, " ").trim();
  if (!text) return false;
  return NON_CODE_COMPLETION_PATTERNS.some((pattern) => pattern.test(text));
}

export function classifyIssueCompletionEvidence(
  issue: IssueCompletionInput,
  workProducts: IssueWorkProduct[],
): IssueCompletionEvidence {
  const hasPullRequest = workProducts.some((product) => product.type === "pull_request");
  const codeChangeProducts = workProducts.filter((product) => CODE_CHANGE_WORK_PRODUCT_TYPES.has(product.type));
  const openPullRequests = workProducts.filter(isOpenPullRequest);
  const completionProducts = workProducts.filter(
    (product) => COMPLETION_WORK_PRODUCT_TYPES.has(product.type) && isCompletedWorkProduct(product),
  );
  const documentOrArtifactProducts = workProducts.filter(
    (product) => (product.type === "document" || product.type === "artifact") && isCompletedWorkProduct(product),
  );
  const operationalOrigin = isOperationalOrigin(issue.originKind ?? null);
  const manualOperationalCompletion = isManualOperationalCompletion(issue);
  const likelyCodeShippingCompletion = isLikelyCodeShippingCompletion(issue);
  const likelyNonCodeCompletion = isLikelyNonCodeCompletion(issue);
  const status = issue.status;

  if (status !== "done") {
    return {
      kind: "not_done",
      label: "Not done",
      prExpected: codeChangeProducts.length > 0 || hasPullRequest || likelyCodeShippingCompletion,
      hasPullRequest,
      hasCodeChangeEvidence: codeChangeProducts.length > 0,
      hasCompletionEvidence: completionProducts.length > 0,
      hasOperationalOrigin: operationalOrigin || manualOperationalCompletion,
      evidenceWorkProductIds: completionProducts.map((product) => product.id),
      blockingWorkProductIds: openPullRequests.map((product) => product.id),
      reasons: ["Issue is not completed yet."],
    };
  }

  if (openPullRequests.length > 0) {
    return {
      kind: "code_review_pending",
      label: "Open PR still pending",
      prExpected: true,
      hasPullRequest,
      hasCodeChangeEvidence: true,
      hasCompletionEvidence: completionProducts.length > 0,
      hasOperationalOrigin: operationalOrigin || manualOperationalCompletion,
      evidenceWorkProductIds: completionProducts.map((product) => product.id),
      blockingWorkProductIds: openPullRequests.map((product) => product.id),
      reasons: ["Issue is done but has an open pull request work product."],
    };
  }

  if (codeChangeProducts.length > 0 && completionProducts.length === 0) {
    return {
      kind: "code_review_missing",
      label: "Code evidence needs PR/merge/review",
      prExpected: true,
      hasPullRequest,
      hasCodeChangeEvidence: true,
      hasCompletionEvidence: false,
      hasOperationalOrigin: operationalOrigin || manualOperationalCompletion,
      evidenceWorkProductIds: [],
      blockingWorkProductIds: codeChangeProducts.map((product) => product.id),
      reasons: ["Issue is done with branch or commit evidence but no PR, merge, deployment, or approved review evidence."],
    };
  }

  if (codeChangeProducts.length > 0 || completionProducts.some((product) => product.type === "pull_request")) {
    return {
      kind: "code_shipped",
      label: "Code shipped/reviewed",
      prExpected: true,
      hasPullRequest,
      hasCodeChangeEvidence: codeChangeProducts.length > 0,
      hasCompletionEvidence: completionProducts.length > 0,
      hasOperationalOrigin: operationalOrigin || manualOperationalCompletion,
      evidenceWorkProductIds: completionProducts.map((product) => product.id),
      blockingWorkProductIds: [],
      reasons: ["Completion has PR, merge, deployment, or approved review evidence."],
    };
  }

  if (operationalOrigin) {
    return {
      kind: "operational",
      label: "Operational completion",
      prExpected: false,
      hasPullRequest,
      hasCodeChangeEvidence: false,
      hasCompletionEvidence: documentOrArtifactProducts.length > 0,
      hasOperationalOrigin: true,
      evidenceWorkProductIds: documentOrArtifactProducts.map((product) => product.id),
      blockingWorkProductIds: [],
      reasons: ["Issue origin is operational/recovery/review work, so no pull request is expected."],
    };
  }

  if (manualOperationalCompletion) {
    return {
      kind: "operational",
      label: "Operational completion",
      prExpected: false,
      hasPullRequest,
      hasCodeChangeEvidence: false,
      hasCompletionEvidence: documentOrArtifactProducts.length > 0,
      hasOperationalOrigin: true,
      evidenceWorkProductIds: documentOrArtifactProducts.map((product) => product.id),
      blockingWorkProductIds: [],
      reasons: ["Issue text describes operational, QA, routing, recovery, or deployment-verification work, so no pull request is expected."],
    };
  }

  if (documentOrArtifactProducts.length > 0) {
    return {
      kind: "evidence_present",
      label: "Non-code evidence recorded",
      prExpected: false,
      hasPullRequest,
      hasCodeChangeEvidence: false,
      hasCompletionEvidence: true,
      hasOperationalOrigin: false,
      evidenceWorkProductIds: documentOrArtifactProducts.map((product) => product.id),
      blockingWorkProductIds: [],
      reasons: ["Issue is done with document or artifact evidence and no code-change evidence."],
    };
  }

  if (likelyCodeShippingCompletion) {
    return {
      kind: "code_review_missing",
      label: "Code evidence needs PR/merge/review",
      prExpected: true,
      hasPullRequest,
      hasCodeChangeEvidence: false,
      hasCompletionEvidence: false,
      hasOperationalOrigin: false,
      evidenceWorkProductIds: [],
      blockingWorkProductIds: [],
      reasons: ["Issue text describes code-shipping work, but no PR, merge, deployment, review, or artifact evidence is structured."],
    };
  }

  if (likelyNonCodeCompletion) {
    return {
      kind: "non_code_completion",
      label: "Non-code completion",
      prExpected: false,
      hasPullRequest,
      hasCodeChangeEvidence: false,
      hasCompletionEvidence: documentOrArtifactProducts.length > 0,
      hasOperationalOrigin: false,
      evidenceWorkProductIds: documentOrArtifactProducts.map((product) => product.id),
      blockingWorkProductIds: [],
      reasons: ["Issue text describes non-code domain work such as content, support, research, marketing, or approval, so no pull request is expected."],
    };
  }

  return {
    kind: "unknown",
    label: "Completion evidence unknown",
    prExpected: false,
    hasPullRequest,
    hasCodeChangeEvidence: false,
    hasCompletionEvidence: false,
    hasOperationalOrigin: false,
    evidenceWorkProductIds: [],
    blockingWorkProductIds: [],
    reasons: ["Issue is done without structured code or operational completion evidence."],
  };
}
