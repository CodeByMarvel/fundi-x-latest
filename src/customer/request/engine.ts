import { getCategory } from './data/categories';
import { QUESTIONS } from './data/questions';
import { Answers, RequestDraft, Vehicle } from './types';

/**
 * The request flow is a list of steps derived from the draft. Picking an
 * answer can add steps (follow-up questions) or remove them, so the list is
 * recomputed after every change rather than hard-coded.
 */
export type StepKey =
  | 'need'
  | 'vehicle'
  | 'category'
  | `question:${string}`
  | 'description'
  | 'media'
  | 'drivability'
  | 'location'
  | 'urgency'
  | 'review';

export const STAGE_COUNT = 10;

/** 1-based stage shown in the progress dots. */
export function stageOf(step: StepKey): number {
  if (step.startsWith('question:')) {
    return 4;
  }
  const stages: Record<string, number> = {
    need: 1,
    vehicle: 2,
    category: 3,
    description: 5,
    media: 6,
    drivability: 7,
    location: 8,
    urgency: 9,
    review: 10,
  };
  return stages[step];
}

export function questionStep(questionId: string): StepKey {
  return `question:${questionId}`;
}

export function questionIdOf(step: StepKey): string | undefined {
  return step.startsWith('question:')
    ? step.slice('question:'.length)
    : undefined;
}

/**
 * Walks the category's questions, inserting follow-ups for picked options,
 * and stops at the first unanswered question.
 */
export function resolveQuestionPath(
  categoryId: string | undefined,
  answers: Answers,
): string[] {
  const category = getCategory(categoryId);
  if (!category) {
    return [];
  }

  const path: string[] = [];
  const queue = [...category.questions];

  while (queue.length > 0) {
    const id = queue.shift()!;
    if (path.includes(id)) {
      continue;
    }
    path.push(id);

    const selected = answers[id];
    if (!selected?.length) {
      break;
    }
    const followUps = QUESTIONS[id].options
      .filter(o => selected.includes(o.id))
      .flatMap(o => o.followUps ?? []);
    queue.unshift(...followUps);
  }

  return path;
}

export function getSteps(draft: RequestDraft): StepKey[] {
  return [
    'need',
    'vehicle',
    'category',
    ...resolveQuestionPath(draft.categoryId, draft.answers).map(questionStep),
    'description',
    'media',
    'drivability',
    'location',
    'urgency',
    'review',
  ];
}

export function isStepComplete(step: StepKey, draft: RequestDraft): boolean {
  const questionId = questionIdOf(step);
  if (questionId) {
    return (draft.answers[questionId]?.length ?? 0) > 0;
  }

  switch (step) {
    case 'need':
      return !!draft.requestType;
    case 'vehicle':
      return !!draft.vehicleId;
    case 'category':
      return !!draft.categoryId;
    case 'description':
    case 'media':
      return true; // optional
    case 'drivability':
      return !!draft.drivability;
    case 'location':
      return !!draft.location;
    case 'urgency':
      return (
        !!draft.urgency &&
        (draft.urgency !== 'scheduled' || !!draft.scheduledFor)
      );
    default:
      return false;
  }
}

/**
 * Where to go after finishing `current`. When the customer is editing from
 * the review screen, skip ahead to the first unanswered step (or straight
 * back to review if nothing is missing).
 */
export function getNextStep(
  draft: RequestDraft,
  current: StepKey,
  editingFromReview: boolean,
): StepKey {
  const steps = getSteps(draft);
  if (editingFromReview) {
    return steps.find(s => !isStepComplete(s, draft)) ?? 'review';
  }
  return steps[steps.indexOf(current) + 1] ?? 'review';
}

/** Drops answers to questions that are no longer on the path. */
function pruneAnswers(categoryId: string | undefined, answers: Answers) {
  const path = resolveQuestionPath(categoryId, answers);
  return Object.fromEntries(
    Object.entries(answers).filter(([id]) => path.includes(id)),
  );
}

/** Applies a change and clears anything the change made irrelevant. */
export function applyChange(
  draft: RequestDraft,
  patch: Partial<RequestDraft>,
): RequestDraft {
  let next = { ...draft, ...patch };

  if (patch.requestType && patch.requestType !== draft.requestType) {
    next = { ...next, categoryId: undefined, answers: {} };
  }
  if (patch.categoryId && patch.categoryId !== draft.categoryId) {
    next = { ...next, answers: {} };
  }
  if (patch.urgency && patch.urgency !== 'scheduled') {
    next = { ...next, scheduledFor: undefined };
  }

  return { ...next, answers: pruneAnswers(next.categoryId, next.answers) };
}

/**
 * The structured request sent to the backend once the customer submits.
 */
export function buildRequestPayload(draft: RequestDraft, vehicle?: Vehicle) {
  const category = getCategory(draft.categoryId);
  const firstQuestion = category?.questions[0];

  return {
    request_type: draft.requestType,
    vehicle_id: vehicle?.id,
    category: draft.categoryId,
    symptoms: firstQuestion ? draft.answers[firstQuestion] ?? [] : [],
    answers: draft.answers,
    description: draft.description.trim(),
    media: draft.media,
    drivability: draft.drivability,
    location: draft.location,
    urgency: draft.urgency,
    scheduling: draft.scheduledFor ?? null,
    preferred_fulfillment: 'best_available',
  };
}
