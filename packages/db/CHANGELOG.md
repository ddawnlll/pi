# Changelog

## [Unreleased]

### Added

- Added Proposal Scoring Engine (P16.C) with rubric and score management
  - Added `proposal_rubrics` table for storing scoring rubrics with named criteria, weights, and max scores
  - Added `proposal_scores` table for storing evaluation results linking proposals to rubrics
  - Added `ProposalRubricRepository` for rubric CRUD operations
  - Added `ProposalScoreRepository` for score CRUD operations with aggregate summaries
  - Added `ProposalScorer` engine for computing weighted scores with manual or automatic scoring
  - Added `ProposalRankingEngine` for ranking proposals by score with rubric weight support
  - Added migration 010 for the new tables with indexes and unique constraints
  - Added 15 unit tests for the scoring and ranking logic
