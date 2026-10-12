import { useEffect, useState } from 'react';

export function useCountdown(endTime: number | null | undefined): number {
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    if (!endTime) {
      setRemaining(0);
      return;
    }

    const update = () => {
      const now = Date.now();
      const diff = Math.max(0, Math.ceil((endTime - now) / 1000));
      setRemaining(diff);
    };

    update();
    const interval = setInterval(update, 500);
    return () => clearInterval(interval);
  }, [endTime]);

  return remaining;
}
