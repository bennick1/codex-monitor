import { useEffect, useState } from "react";
import { INITIAL_TOKEN_VIEW, TokenStatisticsController } from "../lib/tokenStatisticsController";

export function useTokenStatistics(expanded: boolean) {
  const [controller] = useState(() => new TokenStatisticsController());
  const [view, setView] = useState(INITIAL_TOKEN_VIEW);
  useEffect(() => controller.start(setView), [controller]);
  useEffect(() => controller.setExpanded(expanded), [controller, expanded]);
  return { ...view, refresh: controller.refresh };
}
