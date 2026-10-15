import type { EffortLevel, ModelOption } from '../../types';
import { grokRecord } from './grokProtocol';

const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh']);

export function grokModels(value: unknown): ModelOption[] {
  const state = grokRecord(value);
  if (!Array.isArray(state.availableModels)) return [];
  return state.availableModels.flatMap(item => {
    const model = grokRecord(item);
    if (typeof model.modelId !== 'string') return [];
    const meta = grokRecord(model._meta);
    const efforts = Array.isArray(meta.reasoningEfforts) ? meta.reasoningEfforts.map(grokRecord)
      .map(effort => effort.value).filter((effort): effort is EffortLevel => typeof effort === 'string' && EFFORTS.has(effort)) : [];
    const mediaVerified = model.modelId === 'grok-4.7';
    return [{
      id: model.modelId, label: typeof model.name === 'string' ? model.name : model.modelId,
      family: 'grok', description: typeof model.description === 'string' ? model.description : '',
      default: state.currentModelId === model.modelId,
      ...(efforts.length ? { supportedEffortLevels: efforts } : {}),
      capabilities: { input: { text: true, image: mediaVerified, pdf: mediaVerified }, output: { text: true, image: mediaVerified }, toolcall: true, reasoning: true },
    }];
  });
}

export function grokModelsFromInitialize(value: unknown): ModelOption[] {
  return grokModels(grokRecord(grokRecord(value)._meta).modelState);
}
