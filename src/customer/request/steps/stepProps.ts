import { RequestDraft } from '../types';

export type StepProps = {
  draft: RequestDraft;
  /** Update the draft and stay on this step. */
  onChange: (patch: Partial<RequestDraft>) => void;
  /** Update the draft (optional) and move to the next step. */
  onNext: (patch?: Partial<RequestDraft>) => void;
};
