package org.sabilulquran.keycloak.karir;

import java.time.Clock;
import java.time.Duration;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Iterator;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Sliding-window counters held in this Keycloak node's memory. Mi8 runs one Keycloak node, so this is the
 * "local cache" limit of REC-IMPL-001 §4.3; counters reset when Keycloak restarts.
 *
 * <p>Keys are hashes or IP addresses, never an NIK.
 */
public final class RateLimiter {
    private static final int SWEEP_THRESHOLD = 10_000;

    private final Clock clock;
    private final Duration window;
    private final int maxEventsPerKey;
    private final Map<String, Deque<Long>> events = new ConcurrentHashMap<>();
    private final Map<String, Long> blockedUntil = new ConcurrentHashMap<>();

    public RateLimiter(Clock clock, Duration window, int maxEventsPerKey) {
        this.clock = clock;
        this.window = window;
        this.maxEventsPerKey = maxEventsPerKey;
    }

    /** Number of events for the key inside the window, not counting this call. */
    public int count(String key) {
        long now = clock.millis();
        Deque<Long> deque = events.get(key);
        if (deque == null) {
            return 0;
        }
        synchronized (deque) {
            prune(deque, now);
            return deque.size();
        }
    }

    /** Records one event and returns the count including it. */
    public int record(String key) {
        long now = clock.millis();
        sweepIfLarge(now);
        Deque<Long> deque = events.computeIfAbsent(key, ignored -> new ArrayDeque<>());
        synchronized (deque) {
            prune(deque, now);
            deque.addLast(now);
            while (deque.size() > maxEventsPerKey) {
                deque.removeFirst();
            }
            return deque.size();
        }
    }

    /** Records an event only when fewer than {@code limit} are already in the window. */
    public boolean tryAcquire(String key, int limit) {
        long now = clock.millis();
        sweepIfLarge(now);
        Deque<Long> deque = events.computeIfAbsent(key, ignored -> new ArrayDeque<>());
        synchronized (deque) {
            prune(deque, now);
            if (deque.size() >= limit) {
                return false;
            }
            deque.addLast(now);
            return true;
        }
    }

    public void block(String key, Duration duration) {
        blockedUntil.put(key, clock.millis() + duration.toMillis());
    }

    public boolean isBlocked(String key) {
        Long until = blockedUntil.get(key);
        if (until == null) {
            return false;
        }
        if (until <= clock.millis()) {
            blockedUntil.remove(key, until);
            return false;
        }
        return true;
    }

    private void prune(Deque<Long> deque, long now) {
        long cutoff = now - window.toMillis();
        while (!deque.isEmpty() && deque.peekFirst() <= cutoff) {
            deque.removeFirst();
        }
    }

    private void sweepIfLarge(long now) {
        if (events.size() < SWEEP_THRESHOLD && blockedUntil.size() < SWEEP_THRESHOLD) {
            return;
        }
        Iterator<Map.Entry<String, Deque<Long>>> iterator = events.entrySet().iterator();
        while (iterator.hasNext()) {
            Deque<Long> deque = iterator.next().getValue();
            synchronized (deque) {
                prune(deque, now);
                if (deque.isEmpty()) {
                    iterator.remove();
                }
            }
        }
        blockedUntil.values().removeIf(until -> until <= now);
    }
}
