import { Config, SearchResultStage, SearchResultPipeline } from './types.js';

const buildMinSizeStage = (limit: number): SearchResultStage => {
  return (results) => results.filter((item) => !Number.isFinite(item.sizeBytes) || item.sizeBytes >= limit);
};

const buildMaxSizeStage = (limit: number): SearchResultStage => {
  return (results) => results.filter((item) => !Number.isFinite(item.sizeBytes) || item.sizeBytes <= limit);
};

export const createSearchPipeline = (config: Config): SearchResultPipeline => {
  const stages: SearchResultPipeline = [];
  const { searchMinSizeBytes, searchMaxSizeBytes } = config;

  if (Number.isFinite(searchMinSizeBytes) && (searchMinSizeBytes as number) > 0) {
    stages.push(buildMinSizeStage(searchMinSizeBytes as number));
  }

  if (Number.isFinite(searchMaxSizeBytes) && (searchMaxSizeBytes as number) > 0) {
    stages.push(buildMaxSizeStage(searchMaxSizeBytes as number));
  }

  return stages;
};
