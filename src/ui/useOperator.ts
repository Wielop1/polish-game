import { useMemo } from 'react';
import { operatorView, selectedOperatorId } from '../engine/operator.ts';
import type { GameState } from '../engine/state.ts';
import { useGameStore } from '../store/gameStore.ts';

/**
 * Widok stanu gry z punktu widzenia wybranego operatora (JDG albo spółka z o.o.) — tylko do odczytu.
 * Ekrany remontów, pracowników, ekip, pojazdów i rynku czytają ten widok, a komendy gracza (`commands.*`) trafiają na ten sam wybrany podmiot.
 */
export function useOpGame(): GameState {
  const game = useGameStore((s) => s.game)!;
  return useMemo(() => operatorView(game, selectedOperatorId(game)), [game]);
}
