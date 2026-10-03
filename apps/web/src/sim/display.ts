/**
 * Time constant of the fumes picture, in flow-through times: long enough to smooth the small
 * eddies, short enough that a dragged tree's effect shows within a few seconds. A display choice
 * only; the pavement readings use the longer averaging window (streetSim.averagingSteps).
 */
export const DISPLAY_FLOW_THROUGHS = 2;
