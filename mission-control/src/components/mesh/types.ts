export interface NodeHealth {
  nodeId: string;
  platform: string;
  role: string;
  tailscaleIp: string;
  diskPercent: number;
  mem: { total: number; free: number };
  uptimeSeconds: number;
  cpuLoadPercent?: number;
  services: Array<{ name: string; status: string; pid?: number }>;
  agent: {
    status: string;
    currentTask: string | null;
    llm: string | null;
    model: string | null;
    name?: string;
    budgetRemainingSeconds?: number;
  };
  capabilities: string[];
  stats: {
    tasksToday: number;
    successRate: number;
    tokenSpendTodayUsd: number;
  };
  tailscale?: {
    peers: PeerView[];
    selfIp: string;
    natType: string;
    dnsName?: string;
  };
  nats?: {
    serverUrl: string;
    connected: boolean;
    serverVersion: string;
    isHost: boolean;
  };
  deployVersion?: string;
  reportedAt?: string;
}

export interface ActiveTask {
  id: string;
  title: string;
  status: string;
  meshTaskId: string | null;
}

export interface MeshNode {
  nodeId: string;
  status: "online" | "degraded" | "offline";
  health: NodeHealth | null;
  activeTasks: ActiveTask[];
  lastSeen: string | null;
  staleSeconds: number | null;
  tailscale: NodeHealth["tailscale"] | null;
  nats: NodeHealth["nats"] | null;
  cpuLoadPercent: number | null;
  isNatsHost: boolean;
  peerConnectivity: "all_direct" | "some_relay" | "degraded" | "unknown";
}

// Peers come from bin/mesh-health-publisher.js (latency is set only on the cycles
// that ping) and from the /api/mesh/nodes local fallback (latency: null).
export interface PeerView {
  online?: boolean;
  hostname?: string;
  ip?: string;
  os?: string;
  direct?: boolean;
  relay?: string | null;
  latency?: { latencyMs?: number | null } | null;
  lastSeen?: string | null;
}

export interface MeshStatus {
  natsConnected: boolean;
  natsUrl: string;
  localNodeId: string;
  nodesOnline: number;
  nodesTotal: number;
}

export interface MeshEvent {
  event: string;
  task_id: string;
  task?: Record<string, unknown>;
  timestamp: string;
}
