import { useCallback, useEffect, useState } from 'react';
import { MODEL_CATALOG, modelsForProvider, type ModelInfo, type ModelProvider } from '../../shared/models.js';

export interface ModelOptionGroup {
  group: string;
  items: Array<{ value: string; label: string }>;
}

const PROVIDER_LABEL: Record<ModelProvider, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
};

function toGroups(models: ModelInfo[]): ModelOptionGroup[] {
  return (['openai', 'anthropic'] as ModelProvider[])
    .map((provider) => ({
      group: PROVIDER_LABEL[provider],
      items: modelsForProvider(models, provider).filter(x => !x.id.startsWith('compatible/')).map((x) => ({
        value: x.id,
        label: `${x.label} (${x.tier})`,
      })),
    }))
    .concat([{ group: 'OpenAI-compatible', items: models.filter(x => x.id.startsWith('compatible/')).map(x => ({ value: x.id, label: x.label })) }])
    .filter((g) => g.items.length > 0);
}

/**
 * Model options for Select components. Starts with the bundled catalog, then
 * merges the live provider catalog fetched in the main process.
 */
export function useModelOptions() {
  const [models, setModels] = useState<ModelInfo[]>(MODEL_CATALOG);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const apply = useCallback((res: { models: ModelInfo[]; updatedAt: string | null }) => {
    if (res.models?.length) setModels(res.models);
    setUpdatedAt(res.updatedAt);
  }, []);

  useEffect(() => {
    window.electronAPI
      .listModels()
      .then(apply)
      .catch(() => {});
  }, [apply]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await window.electronAPI.refreshModels();
      apply(res);
      return res;
    } finally {
      setRefreshing(false);
    }
  }, [apply]);

  return { models, groups: toGroups(models), updatedAt, refreshing, refresh };
}
