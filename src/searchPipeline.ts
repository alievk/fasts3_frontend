import { Config, SearchResultStage, SearchResultPipeline } from './types.js';

const hasKnownSize = (value: number | null | undefined): value is number => typeof value === 'number' && Number.isFinite(value);

const buildMinSizeStage = (limit: number): SearchResultStage => {
  return (results) => results.filter((item) => !hasKnownSize(item.sizeBytes) || item.sizeBytes >= limit);
};

const buildMaxSizeStage = (limit: number): SearchResultStage => {
  return (results) => results.filter((item) => !hasKnownSize(item.sizeBytes) || item.sizeBytes <= limit);
};

const buildProvidersStage = (allowed: Set<string>): SearchResultStage => {
  return (results) => results.filter((item) => allowed.has(item.provider));
};

export const createSearchPipeline = (config: Config): SearchResultPipeline => {
  const stages: SearchResultPipeline = [];
  const { searchMinSizeBytes, searchMaxSizeBytes, searchProviders } = config;

  if (searchProviders && searchProviders.length > 0) {
    stages.push(buildProvidersStage(new Set(searchProviders)));
  }

  if (Number.isFinite(searchMinSizeBytes) && (searchMinSizeBytes as number) > 0) {
    stages.push(buildMinSizeStage(searchMinSizeBytes as number));
  }

  if (Number.isFinite(searchMaxSizeBytes) && (searchMaxSizeBytes as number) > 0) {
    stages.push(buildMaxSizeStage(searchMaxSizeBytes as number));
  }

  return stages;
};
