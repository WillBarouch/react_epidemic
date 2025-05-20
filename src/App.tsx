'use client';
import { useEffect, useRef, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { AreaChart, Area, XAxis, YAxis, Tooltip, Legend } from 'recharts';
import {type ChartConfig, ChartContainer, ChartLegend, ChartLegendContent} from "@/components/ui/chart";

const WIDTH = 800;
const HEIGHT = 740;
const COMMUNITY_PADDING = 40;

const COMMUNITY_ROWS = 3;
const COMMUNITY_COLS = 3;
const NORMAL_COMMUNITIES = COMMUNITY_ROWS * COMMUNITY_COLS - 1;
const QUARANTINE_COMMUNITY_IDX = 8;
const TOTAL_COMMUNITIES = 9;
const PARTICLE_COUNT = 500;
const PARTICLES_PER_COMMUNITY = Math.floor(PARTICLE_COUNT / NORMAL_COMMUNITIES);
const TRAVEL_PROB = 0.0002;
const VISITING_DURATION = 150;
const CENTRE_VISIT_PROB = 0.001;
const CENTRE_RADIUS = 15;
const CENTRE_DURATION = () => Math.floor(Math.random() * (65 - 20 + 1)) + 20;

const innerW = WIDTH - COMMUNITY_PADDING * (COMMUNITY_COLS + 1);
const innerH = HEIGHT - COMMUNITY_PADDING * (COMMUNITY_ROWS + 1);
const COMMUNITY_WIDTH = innerW / COMMUNITY_COLS;
const COMMUNITY_HEIGHT = innerH / COMMUNITY_ROWS;

const rand = (min = -1, max = 1) => Math.random() * (max - min) + min;

const chartConfig = {
    desktop: {
        label: "Desktop",
        color: "#2563eb",
    },
    mobile: {
        label: "Mobile",
        color: "#60a5fa",
    },
} satisfies ChartConfig

type Status = 'healthy' | 'exposed' | 'infected' | 'recovered' | 'dead';
interface Particle {
    x: number;
    y: number;
    vx: number;
    vy: number;
    status: Status;
    timeInfected: number;
    willDie?: boolean;
    infectionCount?: number;
    homeCommunity: number;
    currentCommunity: number;
    isVisiting: boolean;
    isTravelling: boolean;
    travelTargetX?: number;
    travelTargetY?: number;
    travellingBack: boolean;
    visitTimeLeft?: number;
    atCentre: boolean;
    centreTimeLeft: number;
    quarantined?: boolean;
    timeSinceInfected?: number;
    quarantineEntryAnim?: { animating: boolean; tx: number; ty: number };
    releasedFromQuarantine?: boolean;
    quarantineEligible?: boolean;
    goingHomeAnim?: { animating: boolean; hx: number; hy: number };
}

function getCommunityBounds(idx: number) {
    if (idx === QUARANTINE_COMMUNITY_IDX) {
        // bottom-right cell (8)
        const minX = WIDTH - COMMUNITY_PADDING - COMMUNITY_WIDTH;
        const maxX = WIDTH - COMMUNITY_PADDING;
        const minY = HEIGHT - COMMUNITY_PADDING - COMMUNITY_HEIGHT;
        const maxY = HEIGHT - COMMUNITY_PADDING;
        return {
            minX,
            maxX,
            minY,
            maxY,
            centerX: (minX + maxX) / 2,
            centerY: (minY + maxY) / 2,
        };
    }
    const row = Math.floor(idx / COMMUNITY_COLS);
    const col = idx % COMMUNITY_COLS;
    if (idx > 7) throw new Error('Quarantine only at index 8');
    const minX = COMMUNITY_PADDING + col * (COMMUNITY_WIDTH + COMMUNITY_PADDING);
    const maxX = minX + COMMUNITY_WIDTH;
    const minY = COMMUNITY_PADDING + row * (COMMUNITY_HEIGHT + COMMUNITY_PADDING);
    const maxY = minY + COMMUNITY_HEIGHT;
    return {
        minX,
        maxX,
        minY,
        maxY,
        centerX: (minX + maxX) / 2,
        centerY: (minY + maxY) / 2,
    };
}

function makeSpatialHash(
    ps: Particle[],
    cellSize: number,
    onlyCommunity?: number,
): Record<string, number[]> {
    const hash: Record<string, number[]> = {};
    for (let i = 0; i < ps.length; ++i) {
        if (onlyCommunity !== undefined && ps[i].currentCommunity !== onlyCommunity) continue;
        if (ps[i].status === 'dead') continue;
        const cx = Math.floor(ps[i].x / cellSize);
        const cy = Math.floor(ps[i].y / cellSize);
        const key = `${ps[i].currentCommunity}:${cx},${cy}`;
        (hash[key] = hash[key] || []).push(i);
    }
    return hash;
}
function getNearbyCellCoords(x: number, y: number, radius: number, cellSize: number) {
    const cells = [];
    const minX = Math.floor((x - radius) / cellSize);
    const maxX = Math.floor((x + radius) / cellSize);
    const minY = Math.floor((y - radius) / cellSize);
    const maxY = Math.floor((y + radius) / cellSize);
    for (let cx = minX; cx <= maxX; ++cx) for (let cy = minY; cy <= maxY; ++cy) cells.push([cx, cy]);
    return cells;
}

function initialState(count: number, initialInfected: number): Particle[] {
    return Array.from({ length: count }, (_, i) => {
        const community = Math.floor(i / PARTICLES_PER_COMMUNITY);
        const homeCommunity = Math.min(community, NORMAL_COMMUNITIES - 1);
        const { minX, maxX, minY, maxY } = getCommunityBounds(homeCommunity);
        return {
            x: Math.random() * (maxX - minX) + minX,
            y: Math.random() * (maxY - minY) + minY,
            vx: rand() * 0.3,
            vy: rand() * 0.3,
            status: i < initialInfected ? 'infected' : 'healthy',
            timeInfected: 0,
            willDie: undefined,
            infectionCount: 0,
            homeCommunity: homeCommunity,
            currentCommunity: homeCommunity,
            isVisiting: false,
            isTravelling: false,
            travelTargetX: undefined,
            travelTargetY: undefined,
            travellingBack: false,
            visitTimeLeft: 0,
            atCentre: false,
            centreTimeLeft: 0,
            quarantined: false,
            timeSinceInfected: i < initialInfected ? 0 : undefined,
            releasedFromQuarantine: false,
            quarantineEligible: undefined,
            goingHomeAnim: undefined,
        };
    });
}

export default function ParticleSim() {
    const [initialInfected, setInitialInfected] = useState(5);
    const [incubationPeriod, setIncubationPeriod] = useState(50);
    const [infectionRadius, setInfectionRadius] = useState(20);
    const [infectionProbability, setInfectionProbability] = useState(0.2);
    const [recoveryTime, setRecoveryTime] = useState(300);
    const [deathRate, setDeathRate] = useState(0.01);
    const [speed, setSpeed] = useState(1);
    const [running, setRunning] = useState(false);
    const [quarantineMode, setQuarantineMode] = useState(false);
    const [quarantineEffectiveness, setQuarantineEffectiveness] = useState(70); // 0-100 percent
    const [particles, setParticles] = useState(() =>
        initialState(PARTICLE_COUNT, initialInfected),
    );
    const [history, setHistory] = useState<any[]>([]);
    const [rt, setRt] = useState(0);
    const [maxRt, setMaxRt] = useState(0);

    const particlesRef = useRef(particles.slice());
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const timeRef = useRef(0);
    const infectionEventsRef = useRef<{ infectorIndex: number; time: number }[]>([]);
    const infectedInfectionCountsRef = useRef<Map<number, number>>(new Map());

    const restartSimulation = () => {
        const newParticles = initialState(PARTICLE_COUNT, initialInfected);
        setParticles(newParticles);
        particlesRef.current = newParticles.slice();
        setHistory([]);
        timeRef.current = 0;
        infectionEventsRef.current = [];
        infectedInfectionCountsRef.current = new Map();
        setRt(0);
        setMaxRt(0);
        setRunning(true);
    };

    useEffect(() => {
        if (!running) return;
        let animationFrame: number;
        const ctx = canvasRef.current?.getContext('2d');
        if (!ctx) return;

        function animate() {
            for (let s = 0; s < speed; ++s) {
                timeRef.current++;
                const ps = particlesRef.current;

                for (let i = 0; i < ps.length; ++i) {
                    const p = ps[i];

                    // --- QUARANTINE LOGIC (effectiveness) ---
                    if (quarantineMode) {
                        if (
                            p.status === 'infected' &&
                            (p.timeSinceInfected === undefined || p.timeSinceInfected === null)
                        ) {
                            p.timeSinceInfected = 0;
                        }

                        // quarantineEligible logic: pseudo-random detection, one time per infection.
                        if (
                            p.status === 'infected' &&
                            p.quarantineEligible === undefined
                        ) {
                            p.quarantineEligible =
                                Math.random() * 100 < quarantineEffectiveness;
                        }

                        // Only quarantine those who are eligible for quarantine
                        if (
                            p.status === 'infected' &&
                            p.quarantineEligible &&
                            !p.quarantined &&
                            p.currentCommunity !== QUARANTINE_COMMUNITY_IDX
                        ) {
                            p.timeSinceInfected = (p.timeSinceInfected ?? 0) + 1;
                            // After delay, start quarantine animation
                            if (
                                p.timeSinceInfected >= 5 &&
                                !p.quarantined &&
                                !p.quarantineEntryAnim
                            ) {
                                const target = getCommunityBounds(QUARANTINE_COMMUNITY_IDX);
                                const tx = rand(target.minX + 20, target.maxX - 20);
                                const ty = rand(target.minY + 20, target.maxY - 20);
                                p.quarantineEntryAnim = { animating: true, tx, ty };
                                // set velocity to 0 for the flight
                                p.vx = 0;
                                p.vy = 0;
                                // break the atCentre, visiting or travelling state
                                p.isTravelling = false;
                                p.isVisiting = false;
                                p.atCentre = false;
                                p.centreTimeLeft = 0;
                                p.travellingBack = false;
                            }
                        }

                        // If currently quarantined, increment time
                        if (p.quarantined && p.status === 'infected') {
                            p.timeSinceInfected = (p.timeSinceInfected ?? 0) + 1;
                        }

                        // Release from quarantine if recovered or dead: fly home
                        if (
                            p.quarantined &&
                            (p.status === 'recovered' || p.status === 'dead') &&
                            !p.goingHomeAnim
                        ) {
                            const target = getCommunityBounds(p.homeCommunity);
                            // animate home
                            p.goingHomeAnim = {
                                animating: true,
                                hx: target.centerX + rand(-30, 30),
                                hy: target.centerY + rand(-30, 30),
                            };
                        }
                    }

                    // --- Animate Quarantine Entry ---
                    if (p.quarantineEntryAnim?.animating) {
                        const { tx, ty } = p.quarantineEntryAnim;
                        const dx = tx - p.x,
                            dy = ty - p.y;
                        const dist = Math.sqrt(dx * dx + dy * dy);
                        const step = Math.min(dist, 10);
                        if (dist < 3) {
                            p.x = tx;
                            p.y = ty;
                            p.quarantined = true;
                            p.currentCommunity = QUARANTINE_COMMUNITY_IDX;
                            p.quarantineEntryAnim = undefined;
                            p.vx = 0;
                            p.vy = 0;
                            // random static location, but do NOT move
                        } else {
                            p.x += (dx / dist) * step;
                            p.y += (dy / dist) * step;
                        }
                        continue;
                    }

                    // --- Animate Going Home after Quarantine ---
                    if (p.goingHomeAnim?.animating) {
                        const { hx, hy } = p.goingHomeAnim;
                        const dx = hx - p.x,
                            dy = hy - p.y;
                        const dist = Math.sqrt(dx * dx + dy * dy);
                        const step = Math.min(dist, 10);
                        if (dist < 3) {
                            // "arrived home"
                            p.x = hx;
                            p.y = hy;
                            p.currentCommunity = p.homeCommunity;
                            p.quarantined = false;
                            p.quarantineEligible = undefined;
                            p.timeSinceInfected = undefined;
                            p.goingHomeAnim = undefined;
                            p.vx = rand() * 0.3;
                            p.vy = rand() * 0.3;
                            // fresh start, break all "special" state
                            p.atCentre = false;
                            p.isVisiting = false;
                            p.isTravelling = false;
                            p.travellingBack = false;
                        } else {
                            p.x += (dx / dist) * step;
                            p.y += (dy / dist) * step;
                        }
                        continue;
                    }

                    // --- Quarantined: Make them perfectly still (not even wiggle at all) ---
                    if (p.quarantined) {
                        // freeze at their static position inside the quarantine zone
                        // no velocity, no position change
                        continue;
                    }

                    // --- Normal community behaviour ---
                    const bounds = getCommunityBounds(p.currentCommunity);

                    // "bounce off" with a little reposition inside: prevents edge sticking for all particles
                    if (p.x < bounds.minX) {
                        p.x = bounds.minX + 1.2;
                        p.vx = Math.abs(p.vx) || 0.15;
                    } else if (p.x > bounds.maxX) {
                        p.x = bounds.maxX - 1.2;
                        p.vx = -Math.abs(p.vx) || -0.15;
                    }
                    if (p.y < bounds.minY) {
                        p.y = bounds.minY + 1.2;
                        p.vy = Math.abs(p.vy) || 0.15;
                    } else if (p.y > bounds.maxY) {
                        p.y = bounds.maxY - 1.2;
                        p.vy = -Math.abs(p.vy) || -0.15;
                    }

                    // --- Center logic (never in quarantine) ---
                    if (
                        !p.atCentre &&
                        Math.random() < CENTRE_VISIT_PROB &&
                        !p.isTravelling &&
                        !p.isVisiting &&
                        p.currentCommunity !== QUARANTINE_COMMUNITY_IDX
                    ) {
                        p.atCentre = true;
                        p.centreTimeLeft = CENTRE_DURATION() + Math.floor(Math.random() * 40);
                        const angle = rand(0, 2 * Math.PI);
                        const r = rand(0, CENTRE_RADIUS - 5);
                        p.x = bounds.centerX + r * Math.cos(angle);
                        p.y = bounds.centerY + r * Math.sin(angle);
                        p.vx = 0;
                        p.vy = 0;
                    }
                    if (p.atCentre) {
                        p.centreTimeLeft--;
                        const angle = rand(0, 2 * Math.PI);
                        p.x += Math.cos(angle) * 0.9;
                        p.y += Math.sin(angle) * 0.9;
                        if (p.centreTimeLeft <= 0) {
                            p.atCentre = false;
                            p.x = Math.min(Math.max(bounds.minX + 5, p.x), bounds.maxX - 5);
                            p.y = Math.min(Math.max(bounds.minY + 5, p.y), bounds.maxY - 5);
                            p.vx = rand() * 0.3;
                            p.vy = rand() * 0.3;
                        }
                        continue;
                    }

                    // ---- Intercommunity movement ----
                    if (p.isTravelling) {
                        if (p.travelTargetX == null || p.travelTargetY == null) {
                            const dest = p.travellingBack
                                ? getCommunityBounds(p.homeCommunity)
                                : getCommunityBounds(p.currentCommunity);
                            p.travelTargetX = dest.centerX + rand(-30, 30);
                            p.travelTargetY = dest.centerY + rand(-30, 30);
                        }
                        const dx = p.travelTargetX! - p.x,
                            dy = p.travelTargetY! - p.y;
                        const dist = Math.sqrt(dx ** 2 + dy ** 2);
                        const step = Math.min(8, dist);
                        if (dist < 3) {
                            p.x = p.travelTargetX!;
                            p.y = p.travelTargetY!;
                            p.isTravelling = false;
                            p.vx = rand() * 0.4;
                            p.vy = rand() * 0.4;
                            p.travelTargetX = undefined;
                            p.travelTargetY = undefined;
                            if (p.travellingBack) {
                                p.travellingBack = false;
                                p.isVisiting = false;
                                p.currentCommunity = p.homeCommunity;
                            } else {
                                p.isVisiting = true;
                                p.visitTimeLeft = VISITING_DURATION + Math.floor(Math.random() * 40);
                            }
                        } else {
                            p.x += (dx / dist) * step;
                            p.y += (dy / dist) * step;
                        }
                        continue;
                    }

                    // -- Standard Brownian motion --
                    p.vx += rand(-0.02, 0.02);
                    p.vy += rand(-0.02, 0.02);
                    p.x += p.vx;
                    p.y += p.vy;

                    // Additional edge unsticking for the bounce:
                    if (p.x < bounds.minX + 1) {
                        p.x = bounds.minX + 1.1;
                        p.vx = Math.abs(p.vx) || 0.08;
                    } else if (p.x > bounds.maxX - 1) {
                        p.x = bounds.maxX - 1.1;
                        p.vx = -Math.abs(p.vx) || -0.08;
                    }
                    if (p.y < bounds.minY + 1) {
                        p.y = bounds.minY + 1.1;
                        p.vy = Math.abs(p.vy) || 0.08;
                    } else if (p.y > bounds.maxY - 1) {
                        p.y = bounds.maxY - 1.1;
                        p.vy = -Math.abs(p.vy) || -0.08;
                    }

                    // --- Intercommunity "random travel" ---
                    if (
                        !p.isVisiting &&
                        !p.isTravelling &&
                        Math.random() < TRAVEL_PROB &&
                        p.currentCommunity !== QUARANTINE_COMMUNITY_IDX
                    ) {
                        const available = [];
                        for (let ci = 0; ci < NORMAL_COMMUNITIES; ++ci) {
                            if (ci !== p.homeCommunity) available.push(ci);
                        }
                        if (available.length > 0) {
                            const newCom = available[Math.floor(Math.random() * available.length)];
                            p.currentCommunity = newCom;
                            p.isTravelling = true;
                            p.travellingBack = false;
                            p.visitTimeLeft = 0;
                            p.travelTargetX = undefined;
                            p.travelTargetY = undefined;
                        }
                    }

                    if (p.isVisiting && !p.isTravelling) {
                        if (typeof p.visitTimeLeft === 'number') p.visitTimeLeft!--;
                        if (p.visitTimeLeft! <= 0) {
                            p.isTravelling = true;
                            p.travellingBack = true;
                            p.travelTargetX = undefined;
                            p.travelTargetY = undefined;
                            p.isVisiting = false;
                            p.currentCommunity = p.homeCommunity;
                        }
                    }
                }

                // ---- Infection Logic ---
                const cellSize = infectionRadius + 3;
                for (let community = 0; community < NORMAL_COMMUNITIES; ++community) {
                    const hash = makeSpatialHash(ps, cellSize, community);
                    for (let i = 0; i < ps.length; ++i) {
                        const p = ps[i];
                        if (p.currentCommunity !== community || p.quarantined || p.status !== 'infected') continue;
                        p.timeInfected++;
                        if (p.willDie === undefined) {
                            p.willDie = Math.random() < deathRate;
                            p.infectionCount = 0;
                            infectedInfectionCountsRef.current.set(i, 0);
                        }
                        if (p.willDie && p.timeInfected > recoveryTime / 2) {
                            p.status = 'dead';
                            infectedInfectionCountsRef.current.delete(i);
                            continue;
                        }
                        if (!p.willDie && p.timeInfected > recoveryTime) {
                            p.status = 'recovered';
                            infectedInfectionCountsRef.current.delete(i);
                            continue;
                        }
                        const cx = Math.floor(p.x / cellSize);
                        const cy = Math.floor(p.y / cellSize);
                        const relCells = getNearbyCellCoords(p.x, p.y, infectionRadius, cellSize);
                        for (const [nx, ny] of relCells) {
                            const key = `${community}:${nx},${ny}`;
                            const idxs = hash[key];
                            if (!idxs) continue;
                            for (const j of idxs) {
                                if (i === j) continue;
                                const other = ps[j];
                                if (other.status !== 'healthy') continue;
                                if (
                                    (p.atCentre && other.atCentre && p.currentCommunity === other.currentCommunity) ||
                                    (!p.atCentre && !other.atCentre)
                                ) {
                                    const dx = p.x - other.x, dy = p.y - other.y;
                                    if (dx * dx + dy * dy < infectionRadius * infectionRadius) {
                                        if (Math.random() < infectionProbability / 10) {
                                            other.status = 'exposed';
                                            other.timeInfected = 0;
                                            infectionEventsRef.current.push({
                                                infectorIndex: i,
                                                time: timeRef.current,
                                            });
                                            const cnt = infectedInfectionCountsRef.current.get(i) ?? 0;
                                            infectedInfectionCountsRef.current.set(i, cnt + 1);
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                // Exposed state for all
                for (let i = 0; i < ps.length; ++i) {
                    const p = ps[i];
                    if (p.status === 'exposed') {
                        p.timeInfected++;
                        if (p.timeInfected > incubationPeriod) {
                            p.status = 'infected';
                            p.timeInfected = 0;
                            p.willDie = undefined;
                            // (re)set quarantine eligibility
                            if (quarantineMode) {
                                p.timeSinceInfected = 0;
                                p.quarantineEligible = undefined;
                            }
                        }
                    }
                }
            }

            // --- DRAW ---
            const ctx = canvasRef.current?.getContext('2d');
            if (!ctx) return;
            ctx.clearRect(0, 0, WIDTH, HEIGHT);

            for (let idx = 0; idx < TOTAL_COMMUNITIES; idx++) {
                const { minX, minY, maxX, maxY, centerX, centerY } = getCommunityBounds(idx);
                ctx.beginPath();
                ctx.strokeStyle = idx === QUARANTINE_COMMUNITY_IDX ? '#ff3b3b' : '#60708C';
                ctx.lineWidth = idx === QUARANTINE_COMMUNITY_IDX ? 4 : 2;
                ctx.rect(minX, minY, maxX - minX, maxY - minY);
                ctx.stroke();
                if (idx !== QUARANTINE_COMMUNITY_IDX) {
                    ctx.beginPath();
                    ctx.arc(centerX, centerY, CENTRE_RADIUS, 0, 2 * Math.PI);
                    ctx.strokeStyle = '#c0c0c0';
                    ctx.lineWidth = 1.5;
                    ctx.stroke();
                }
            }

            // Draw all particles
            for (const p of particlesRef.current) {
                if (p.status === 'infected' && !p.quarantined && !p.quarantineEntryAnim) {
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, infectionRadius, 0, 2 * Math.PI);
                    ctx.strokeStyle = '#bf616a';
                    ctx.lineWidth = 2;
                    ctx.stroke();
                }
                ctx.beginPath();
                ctx.arc(p.x, p.y, 3, 0, 2 * Math.PI);
                if (p.quarantined || p.quarantineEntryAnim) ctx.fillStyle = '#ff3b3b';
                else if (p.status === 'healthy') ctx.fillStyle = '#a3be8c';
                else if (p.status === 'exposed') ctx.fillStyle = '#d08770';
                else if (p.status === 'infected') ctx.fillStyle = '#bf616a';
                else if (p.status === 'recovered') ctx.fillStyle = '#5e81ac';
                else ctx.fillStyle = 'black';
                ctx.fill();
                if (p.atCentre) {
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, 4.5, 0, 2 * Math.PI);
                    ctx.strokeStyle = '#75aaff';
                    ctx.lineWidth = 1;
                    ctx.stroke();
                }
            }

            // --- Statistic State Sync ---
            setParticles(particlesRef.current.slice());
            const counts = {
                healthy: 0,
                exposed: 0,
                infected: 0,
                recovered: 0,
                dead: 0,
                quarantined: 0,
            };
            for (const p of particlesRef.current) {
                if (p.quarantined) counts.quarantined++;
                else counts[p.status]++;
            }
            setHistory((prev) => [
                ...prev,
                { time: timeRef.current, ...counts },
            ]);
            const windowSize = 50;
            const cutoff = timeRef.current - windowSize;
            const recentEvents = infectionEventsRef.current.filter(
                (e) => e.time > cutoff,
            );
            const activeInfectors = new Set(
                recentEvents.map((e) => e.infectorIndex),
            );
            let totalInfections = 0;
            activeInfectors.forEach((infector) => {
                const count = infectedInfectionCountsRef.current.get(
                    infector,
                ) || 0;
                totalInfections += count;
            });

            const newRt = activeInfectors.size > 0 ? totalInfections / activeInfectors.size : 0;

            setMaxRt((prevMaxRt) => Math.max(prevMaxRt, newRt));
            setRt(newRt);

            animationFrame = requestAnimationFrame(animate);
        }

        animationFrame = requestAnimationFrame(animate);
        return () => cancelAnimationFrame(animationFrame);
    }, [
        infectionRadius,
        infectionProbability,
        recoveryTime,
        deathRate,
        incubationPeriod,
        speed,
        running,
        quarantineMode,
        quarantineEffectiveness,
    ]);

    useEffect(() => {
        particlesRef.current = particles.slice();
    }, [particles]);

    const darkBg = 'bg-black text-white';

    return (
        <div className={`grid grid-cols-5 gap-4 p-4 ${darkBg}`}>
            <div className="col-span-2 space-y-4">
                <Card className={darkBg + " h-110 overflow-scroll"}>
                    <CardContent className="space-y-2 pt-4 text-sm">
                        <div>
                            <Label className="py-4">Initial Infected: {initialInfected}</Label>
                            <Slider min={1} max={20} step={1} value={[initialInfected]} onValueChange={([v]) => setInitialInfected(v)} />
                        </div>
                        <div>
                            <Label className="py-4">Incubation Period: {incubationPeriod}</Label>
                            <Slider min={10} max={100} step={1} value={[incubationPeriod]} onValueChange={([v]) => setIncubationPeriod(v)} />
                        </div>
                        <div>
                            <Label className="py-4">
                                Death Rate (Overall): {deathRate.toFixed(2)}
                            </Label>
                            <Slider min={0} max={1} step={0.01} value={[deathRate]} onValueChange={([v]) => setDeathRate(v)} />
                        </div>
                        <div>
                            <Label className="py-4">Infection Radius: {infectionRadius}</Label>
                            <Slider min={5} max={40} step={1} value={[infectionRadius]} onValueChange={([v]) => setInfectionRadius(v)} />
                        </div>
                        <div>
                            <Label className="py-4">
                                Infection Probability: {infectionProbability.toFixed(2)}
                            </Label>
                            <Slider min={0} max={1} step={0.01} value={[infectionProbability]} onValueChange={([v]) => setInfectionProbability(v)} />
                        </div>
                        <div>
                            <Label className="py-4">Recovery Time: {recoveryTime}</Label>
                            <Slider min={100} max={300} step={1} value={[recoveryTime]} onValueChange={([v]) => setRecoveryTime(v)} />
                        </div>
                        <div>
                            <Label className="py-4">Speed: {speed}x</Label>
                            <Slider min={1} max={10} step={1} value={[speed]} onValueChange={([v]) => setSpeed(v)} />
                        </div>
                        <div>
                            <Label className="py-4">
                                <input type="checkbox" checked={quarantineMode} onChange={e => setQuarantineMode(e.target.checked)}
                                       className="mr-2"
                                />
                                Automatic Quarantine (infected moved after 5 ticks)
                            </Label>
                            {quarantineMode && (
                                <div>
                                    <Label className="py-4">
                                        Quarantine Effectiveness: {quarantineEffectiveness}%
                                    </Label>
                                    <Slider min={0} max={100} step={1} value={[quarantineEffectiveness]} onValueChange={([v]) => setQuarantineEffectiveness(v)} />
                                </div>
                            )}
                        </div>
                    </CardContent>
                </Card>
                <Card className="bg-black">
                    <CardContent>
                        <ChartContainer config={chartConfig} className="min-h-[200px] w-full self-center">
                            <AreaChart
                                width={700}
                                height={270}
                                data={history}
                                margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
                                className="mt-4"
                            >
                                <Area type="monotone" dataKey="infected" stackId="1" fill="#bf616a" stroke="none"/>
                                <Area type="monotone" dataKey="quarantined" stackId="1" fill="#ff7b7b" stroke="none"/>
                                <Area type="monotone" dataKey="healthy" stackId="1" fill="#a3be8c" stroke="none"/>
                                <Area type="monotone" dataKey="exposed" stackId="1" fill="#d08770" stroke="none"/>
                                <Area type="monotone" dataKey="recovered" stackId="1" fill="#5e81ac" stroke="none"/>
                                <Area type="monotone" dataKey="dead" stackId="1" fill="black" stroke="none"/>
                                <XAxis/>
                                <YAxis/>
                            </AreaChart>
                        </ChartContainer>
                    </CardContent>
                </Card>
            </div>
            <div className="col-span-3">
                <canvas ref={canvasRef} width={WIDTH} height={HEIGHT} className="rounded-lg border border-gray-600" />
                <div className="flex gap-4 py-6">
                    <Button onClick={() => setRunning(!running)}>
                        {running ? 'Pause' : 'Start'}
                    </Button>
                    <Button onClick={restartSimulation}>Restart</Button>
                    <div className="mt-2 text-white align-middle">
                        R<sub>t</sub>: {rt.toFixed(2)} | Max R<sub>t</sub>: {maxRt.toFixed(2)}
                    </div>
                </div>
            </div>
        </div>
    );
}