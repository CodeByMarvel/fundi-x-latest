import {
  applyChange,
  getNextStep,
  getSteps,
  resolveQuestionPath,
} from '../src/customer/request/engine';
import { EMPTY_DRAFT, RequestDraft } from '../src/customer/request/types';

const brakes: RequestDraft = {
  ...EMPTY_DRAFT,
  requestType: 'repair',
  vehicleId: 'v1',
  categoryId: 'brakes',
};

describe('request engine', () => {
  it('stops at the first unanswered question', () => {
    expect(resolveQuestionPath('brakes', {})).toEqual(['brakes.symptoms']);
  });

  it('inserts follow-ups right after the question that triggered them', () => {
    const path = resolveQuestionPath('brakes', {
      'brakes.symptoms': ['noise', 'vibration'],
      'brakes.noise_when': ['braking'],
      'brakes.noise_type': ['grinding'],
      'common.since': ['today'],
    });
    expect(path).toEqual([
      'brakes.symptoms',
      'brakes.noise_when',
      'brakes.noise_type',
      'common.since',
    ]);
  });

  it('skips follow-ups when the triggering option is not picked', () => {
    const path = resolveQuestionPath('brakes', {
      'brakes.symptoms': ['vibration'],
      'common.since': ['today'],
    });
    expect(path).toEqual(['brakes.symptoms', 'common.since']);
  });

  it('goes from the category to its first question, then on to the next', () => {
    expect(getNextStep(brakes, 'category', false)).toBe(
      'question:brakes.symptoms',
    );
    const answered = applyChange(brakes, {
      answers: { 'brakes.symptoms': ['noise'] },
    });
    expect(getNextStep(answered, 'question:brakes.symptoms', false)).toBe(
      'question:brakes.noise_when',
    );
  });

  it('drops answers that no longer apply when an earlier answer changes', () => {
    const withNoise = applyChange(brakes, {
      answers: {
        'brakes.symptoms': ['noise'],
        'brakes.noise_when': ['braking'],
      },
    });
    const changed = applyChange(withNoise, {
      answers: { ...withNoise.answers, 'brakes.symptoms': ['vibration'] },
    });
    expect(changed.answers).toEqual({ 'brakes.symptoms': ['vibration'] });
  });

  it('clears the category and answers when switching repair/service', () => {
    const answered = applyChange(brakes, {
      answers: { 'brakes.symptoms': ['vibration'] },
    });
    const switched = applyChange(answered, { requestType: 'service' });
    expect(switched.categoryId).toBeUndefined();
    expect(switched.answers).toEqual({});
  });

  it('returns to review after an edit when nothing is missing', () => {
    const complete = applyChange(brakes, {
      answers: {
        'brakes.symptoms': ['vibration'],
        'common.since': ['today'],
      },
      drivability: 'safe',
      location: { kind: 'home', label: 'Home', address: 'Kileleshwa' },
      urgency: 'today',
    });
    expect(getNextStep(complete, 'vehicle', true)).toBe('review');
  });

  it('after changing the category from review, asks the new questions', () => {
    const complete = applyChange(brakes, {
      answers: { 'brakes.symptoms': ['vibration'], 'common.since': ['today'] },
      drivability: 'safe',
      location: { kind: 'home', label: 'Home', address: 'Kileleshwa' },
      urgency: 'today',
    });
    const recategorised = applyChange(complete, { categoryId: 'engine' });
    expect(getNextStep(recategorised, 'category', true)).toBe(
      'question:engine.symptoms',
    );
  });

  it('service categories without questions skip straight to description', () => {
    const draft = applyChange(EMPTY_DRAFT, {
      requestType: 'service',
      vehicleId: 'v1',
      categoryId: 'other_service',
    });
    expect(getSteps(draft)).not.toContainEqual(
      expect.stringMatching(/^question:/),
    );
    expect(getNextStep(draft, 'category', false)).toBe('description');
  });
});
