import { Button } from './mobilePrimitives';
import type { PendingInteraction } from './types';

/** Plan decisions send the same tokens as desktop; free text is revision feedback only where the backend accepts it. */
export function InteractionCard(props: {
  interaction: PendingInteraction;
  answer: string;
  allowPlanFeedback: boolean;
  setAnswer: (value: string) => void;
  onSubmit: (answer?: string) => void;
}) {
  if (props.interaction.kind === 'plan') {
    return (
      <section className="interaction-card">
        <strong>Plan Approval</strong>
        <p>{props.interaction.prompt}</p>
        {props.allowPlanFeedback ? (
          <textarea aria-label="Plan revision feedback" placeholder="Describe changes…" value={props.answer} onChange={(event) => props.setAnswer(event.target.value)} rows={3} />
        ) : null}
        <div className="button-row">
          {props.allowPlanFeedback ? <Button label="Request changes" disabled={!props.answer.trim()} onClick={() => props.onSubmit()} /> : null}
          <Button label="Reject" variant="danger" onClick={() => props.onSubmit('no')} />
          <Button label="Approve & run" variant="primary" onClick={() => props.onSubmit('yes')} />
        </div>
      </section>
    );
  }
  return (
    <section className="interaction-card">
      <strong>Question</strong>
      <p>{props.interaction.prompt}</p>
      <div className="button-row">
        {props.interaction.options.map((option) => <Button key={option.label} label={option.label} onClick={() => props.setAnswer(option.label)} />)}
      </div>
      <textarea value={props.answer} onChange={(event) => props.setAnswer(event.target.value)} rows={3} />
      <Button label="Answer" variant="primary" disabled={!props.answer.trim()} onClick={() => props.onSubmit()} />
    </section>
  );
}
