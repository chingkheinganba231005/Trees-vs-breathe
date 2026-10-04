import {
  result,
  type StreetAtlasCandidate,
  type StreetAtlasResult,
} from './results';

export const atlas = () => result<StreetAtlasResult>('atlas/atlas.json')?.rows ?? [];

export const atlasDesignLabel: Record<StreetAtlasCandidate['design'], string> = {
  bare: 'Bare street',
  sparse_trees: 'Sparse trees',
  dense_trees: 'Dense trees',
  central_hedge: 'Central hedge',
};

export const atlasDesignLabelTc: Record<StreetAtlasCandidate['design'], string> = {
  bare: '沒有樹木',
  sparse_trees: '疏落樹木',
  dense_trees: '密集樹木',
  central_hedge: '中央綠籬',
};
