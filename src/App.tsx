import { useState, useEffect, useRef, useMemo, type ReactNode } from "react";
import {
  Wallet,
  Users,
  Layers,
  ShieldCheck,
  Settings2,
  Copy,
  ExternalLink,
  RefreshCw,
  Plus,
  KeyRound,
  ArrowUpRight,
  X,
  Download,
  Check,
  AlertTriangle,
  Loader2,
  Search,
  ScanLine,
  CheckCircle2,
  Building2,
  ChevronDown,
} from "lucide-react";
import {
  formatUnits,
  getAddress,
  encodeAbiParameters,
  type Address,
  type Hex,
} from "viem";
import {
  DEFAULT_WALLET,
  NETWORKS,
  address,
  recipientAddress,
  clientFor,
  errorText,
  same,
  short,
  json,
  download,
  type Network,
} from "./chain";
import {
  inspect,
  assertAddition,
  assertSameOwners,
  type Snapshot,
  type Owner,
} from "./wallet";
import {
  baseAssets,
  discover,
  importAsset,
  amountFor,
  displayBalance,
  scanTransfers,
  holding,
  type Asset,
  type AssetKind,
  type Selection,
} from "./assets";
import {
  providersAvailable,
  coinbaseProvider,
  connect,
  switchNetwork,
  previewAddition,
  previewRecovery,
  submit,
  safeExport,
  feeLabel,
  watchConnection,
  assertExecutionReceipt,
  type Preview,
  type Connection,
  type ProviderInfo,
} from "./signing";
import trusted from "./trusted-code.json";
import { resolveAddress } from "./ens";
import { AddressLine, ResolutionHint, OwnerOption } from "./identity";
import { tokenAbi } from "./abi";
import compilation from "../research/compilation.json";
type Page = "owners" | "recovery" | "checks" | "settings";
type ChainResult = {
  status: "checking" | "verified" | "unsupported" | "absent" | "error";
  snapshot?: Snapshot;
  error?: string;
};
type Pending = {
  id: string;
  mode: "transaction" | "calls";
  chainId: number;
  wallet: Address;
  actor?: Address;
  kind: string;
  createdAt: number;
};
const titles: Record<Page, [string, string, string]> = {
  owners: [
    "OWNERS & ACCESS",
    "A backup way in.",
    "Inspect your owners and add another account without replacing existing access.",
  ],
  recovery: [
    "ASSET RECOVERY",
    "Your assets. Your destination.",
    "Choose holdings on one chain and review a single batch transfer.",
  ],
  checks: [
    "CONTRACT CHECKS",
    "Know what controls your wallet.",
    "Live bytecode checks and an independent compilation of the deployed implementation.",
  ],
  settings: [
    "CONNECTIONS",
    "Connect on your terms.",
    "Use a public RPC or your own endpoint. Your private keys stay in your wallet.",
  ],
};
function initialPending(): Pending | null {
  try {
    return JSON.parse(sessionStorage.getItem("reserve-pending") || "null");
  } catch {
    return null;
  }
}
function Modal({
  title,
  close,
  children,
  wide = false,
  locked = false,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
  wide?: boolean;
  locked?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("button,input,select")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !locked) close();
      if (e.key === "Tab") {
        const list = ref.current?.querySelectorAll<HTMLElement>(
          "button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href],textarea",
        );
        if (!list?.length) return;
        const first = list[0],
          last = list[list.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, [locked]);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !locked) close();
      }}
    >
      <div
        ref={ref}
        className={`modal ${wide ? "wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-header">
          <h2>{title}</h2>
          <button
            className="icon-button"
            aria-label="Close dialog"
            disabled={locked}
            onClick={close}
          >
            <X />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
export default function App() {
  const [page, setPage] = useState<Page>("owners");
  const [walletInput, setWalletInput] = useState<string>(DEFAULT_WALLET);
  const [chainId, setChainId] = useState(1);
  const network = NETWORKS.find((n) => n.chain.id === chainId)!;
  const [rpcOverrides, setRpcOverrides] = useState<Record<number, string>>({});
  const rpc = rpcOverrides[chainId];
  const [rpcDraft, setRpcDraft] = useState("");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState("");
  const [toast, setToast] = useState("");
  const [chains, setChains] = useState<Partial<Record<number, ChainResult>>>(
    {},
  );
  const [connection, setConnection] = useState<Connection | null>(null);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [connectOpen, setConnectOpen] = useState(false);
  const actor = connection?.address || "";
  const [connectError, setConnectError] = useState("");
  const [newOwner, setNewOwner] = useState("");
  const [assets, setAssets] = useState<Asset[]>([]);
  const [assetNote, setAssetNote] = useState(
    "Token and NFT discovery has not run yet.",
  );
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [assetFilter, setAssetFilter] = useState("");
  const [recipient, setRecipient] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [importKind, setImportKind] = useState<"erc20" | "erc721" | "erc1155">(
    "erc20",
  );
  const [importAddress, setImportAddress] = useState("");
  const [importId, setImportId] = useState("");
  const [importError, setImportError] = useState("");
  const [scanOpen, setScanOpen] = useState(false);
  const [scanFrom, setScanFrom] = useState("");
  const [scanTo, setScanTo] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [ack, setAck] = useState(false);
  const [confirmedRecipient, setConfirmedRecipient] = useState("");
  const [reviewError, setReviewError] = useState("");
  const [txStatus, setTxStatus] = useState("");
  const [txHash, setTxHash] = useState<Hex | null>(null);
  const [pending, setPending] = useState<Pending | null>(initialPending);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  const generation = useRef(0);
  const taskLock = useRef(false);
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const signing = busy === "signing";
  const activePending =
    !!pending &&
    pending.chainId === chainId &&
    same(pending.wallet, snapshot?.wallet || walletInput);
  const connectedAuthorized =
    !!snapshot &&
    !!connection &&
    (same(snapshot.wallet, connection.address) ||
      snapshot.owners.some(
        (o) => o.address && same(o.address, connection.address),
      ));
  const canReview =
    !!snapshot?.verified && connectedAuthorized && !busy && !activePending;
  const selectedAssets = assets.filter((a) => selected[a.key] !== undefined);
  const visibleAssets = assets.filter((a) =>
    `${a.symbol} ${a.name} ${a.contract || ""} ${a.tokenId ?? ""}`
      .toLowerCase()
      .includes(assetFilter.toLowerCase()),
  );
  const notify = (text: string) => setToast(text);
  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      notify("Copied to clipboard.");
    } catch {
      notify("Clipboard is unavailable. Select and copy the address manually.");
    }
  };
  function clearPreview() {
    setPreview(null);
    setReviewError("");
    setAck(false);
    setConfirmedRecipient("");
  }
  function invalidate() {
    generation.current++;
    setSnapshot(null);
    setAssets([]);
    setSelected({});
    setChains({});
    clearPreview();
    setLoadError("");
    setAssetNote("Inspect the wallet, then discover tokens and NFTs.");
    setTxHash(null);
    setTxStatus("");
  }
  function editWallet(v: string) {
    invalidate();
    setWalletInput(v);
  }
  function editChain(id: number) {
    invalidate();
    setChainId(id);
    setRpcDraft(rpcOverrides[id] || "");
  }
  async function load() {
    if (taskLock.current) return;
    taskLock.current = true;
    setBusy("inspection");
    setLoadError("");
    clearPreview();
    const g = ++generation.current;
    setSnapshot(null);
    setAssets([]);
    setSelected({});
    try {
      const target = (await resolveAddress(walletInput)).address;
      const s = await inspect(network, target, rpc);
      if (g !== generation.current) return;
      setSnapshot(s);
      setAssets(baseAssets(s, network));
      setScanFrom(String(s.block > 10000n ? s.block - 10000n : 0n));
      setScanTo(String(s.block));
      setChains((x) => ({
        ...x,
        [chainId]: {
          status: s.verified ? "verified" : "unsupported",
          snapshot: s,
        },
      }));
      setAssetNote(
        "Native balance and EntryPoint deposit loaded. Discover tokens and NFTs to expand this list.",
      );
    } catch (e) {
      if (g === generation.current) {
        setLoadError(errorText(e));
        setChains((x) => ({
          ...x,
          [chainId]: {
            status: errorText(e).includes("No smart wallet")
              ? "absent"
              : "error",
            error: errorText(e),
          },
        }));
      }
    } finally {
      taskLock.current = false;
      setBusy("");
    }
  }
  useEffect(() => {
    void load();
  }, [chainId]);
  useEffect(
    () =>
      providersAvailable((p) =>
        setProviders((prev) =>
          prev.some((x) => x.uuid === p.uuid || x.provider === p.provider)
            ? prev
            : [...prev, p],
        ),
      ),
    [],
  );
  const assetsRef = useRef(assets);
  assetsRef.current = assets;
  useEffect(() => {
    const ctx = (document as any).modelContext;
    if (!ctx?.registerTool) return;
    const lifecycle = new AbortController();
    const validate = (input: unknown) => {
      if (
        !input ||
        typeof input !== "object" ||
        Array.isArray(input) ||
        Object.keys(input).length
      )
        throw Error("This read-only tool expects an empty object.");
    };
    const tools = [
      {
        name: "get_smart_wallet_snapshot",
        title: "Read inspected smart wallet",
        description:
          "Read the current live wallet snapshot and owner list. Does not connect, sign, or submit transactions.",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute: (input: unknown) => {
          validate(input);
          const s = snapshotRef.current;
          if (!s) throw Error("Inspect a wallet in the interface first.");
          return JSON.parse(json(s));
        },
      },
      {
        name: "get_loaded_wallet_assets",
        title: "Read loaded wallet assets",
        description:
          "Read the assets currently loaded in the recovery interface. The list can be incomplete; does not transfer assets.",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute: (input: unknown) => {
          validate(input);
          if (!snapshotRef.current) throw Error("Inspect a wallet first.");
          return JSON.parse(
            json({
              wallet: snapshotRef.current.wallet,
              chainId: snapshotRef.current.chainId,
              assets: assetsRef.current,
              incompleteDiscoveryPossible: true,
            }),
          );
        },
      },
    ];
    for (const tool of tools)
      try {
        void Promise.resolve(
          ctx.registerTool(tool, { signal: lifecycle.signal }),
        ).catch(() => {});
      } catch {}
    return () => lifecycle.abort();
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (!connection) return;
    return watchConnection(
      connection,
      (account) => {
        clearPreview();
        setConnection(account ? { ...connection, address: account } : null);
        notify(
          account
            ? "Connected account changed. Review the action again."
            : "Wallet disconnected.",
        );
      },
      (id) => {
        clearPreview();
        setConnection({ ...connection, chainId: id });
        notify(
          "Connected wallet network changed. The connection is preserved; review on the selected network.",
        );
      },
      () => {
        clearPreview();
        setConnection(null);
        notify("Wallet disconnected.");
      },
    );
  }, [connection]);
  async function openConnection(p: ProviderInfo) {
    if (taskLock.current) return;
    taskLock.current = true;
    setBusy("connection");
    setConnectError("");
    try {
      const c = await connect(p.provider, p.name);
      setConnection(c);
      setConnectOpen(false);
      clearPreview();
      notify(
        "Wallet connected. Its owner status is checked against on-chain records. Switches are requested when reviewing an action.",
      );
    } catch (e) {
      setConnectError(errorText(e));
    } finally {
      taskLock.current = false;
      setBusy("");
    }
  }
  async function disconnectWallet() {
    const c = connection;
    setConnection(null);
    clearPreview();
    try {
      await c?.provider.disconnect?.();
    } catch {
      notify(
        "Disconnected from this page. You can also disconnect it in your wallet settings.",
      );
    }
  }
  function savePending(p: Pending | null) {
    pendingRef.current = p;
    setPending(p);
    if (p) sessionStorage.setItem("reserve-pending", json(p));
    else sessionStorage.removeItem("reserve-pending");
  }
  async function scanChains() {
    if (taskLock.current) return;
    taskLock.current = true;
    setBusy("chain scan");
    const g = generation.current;
    try {
      const target = (await resolveAddress(walletInput)).address;
      setChains(
        Object.fromEntries(
          NETWORKS.map((n) => [n.chain.id, { status: "checking" }]),
        ),
      );
      await Promise.all(
        NETWORKS.map(async (n) => {
          try {
            const s = await inspect(n, target, rpcOverrides[n.chain.id]);
            if (g === generation.current)
              setChains((x) => ({
                ...x,
                [n.chain.id]: {
                  status: s.verified ? "verified" : "unsupported",
                  snapshot: s,
                },
              }));
          } catch (e) {
            if (g === generation.current)
              setChains((x) => ({
                ...x,
                [n.chain.id]: {
                  status: errorText(e).includes("No smart wallet")
                    ? "absent"
                    : "error",
                  error: errorText(e),
                },
              }));
          }
        }),
      );
    } catch (e) {
      notify(errorText(e));
    } finally {
      taskLock.current = false;
      setBusy("");
    }
  }
  function mergeAssets(incoming: Asset[]) {
    setAssets((old) => [
      ...new Map([...old, ...incoming].map((a) => [a.key, a])).values(),
    ]);
    clearPreview();
    setSelected({});
  }
  async function discoverAssets() {
    if (!snapshot || taskLock.current) return;
    taskLock.current = true;
    setBusy("asset discovery");
    const g = generation.current;
    try {
      const fresh = await inspect(network, snapshot.wallet, rpc);
      assertSameOwners(snapshot, fresh);
      const result = await discover(clientFor(network, rpc), fresh, network);
      if (g !== generation.current) return;
      setSnapshot(fresh);
      mergeAssets([...baseAssets(fresh, network), ...result.assets]);
      setAssetNote(result.note);
    } catch (e) {
      setAssetNote("Discovery incomplete: " + errorText(e));
    } finally {
      taskLock.current = false;
      setBusy("");
    }
  }
  async function doImport() {
    if (!snapshot || taskLock.current) return;
    taskLock.current = true;
    setBusy("import");
    setImportError("");
    try {
      const id = importKind === "erc20" ? undefined : BigInt(importId);
      const a = await importAsset(
        clientFor(network, rpc),
        snapshot,
        importKind,
        (await resolveAddress(importAddress)).address,
        id,
      );
      mergeAssets([a]);
      setImportOpen(false);
      notify(
        a.balance > 0n
          ? "Token imported and holdings verified."
          : "Token imported. This wallet currently has no balance for it.",
      );
    } catch (e) {
      setImportError(errorText(e));
    } finally {
      taskLock.current = false;
      setBusy("");
    }
  }
  async function doScan() {
    if (!snapshot || taskLock.current) return;
    taskLock.current = true;
    setBusy("transfer scan");
    setImportError("");
    try {
      const result = await scanTransfers(
        clientFor(network, rpc),
        snapshot,
        BigInt(scanFrom),
        BigInt(scanTo),
        setTxStatus,
      );
      mergeAssets(result.assets);
      setAssetNote(result.note);
      setScanOpen(false);
      setTxStatus("");
    } catch (e) {
      setImportError(errorText(e));
    } finally {
      taskLock.current = false;
      setBusy("");
    }
  }
  async function review(kind: "addition" | "recovery") {
    if (
      !snapshot ||
      !connection ||
      !connectedAuthorized ||
      taskLock.current ||
      activePending
    )
      return;
    taskLock.current = true;
    setBusy("simulation");
    setReviewError("");
    setTxStatus("");
    setTxHash(null);
    try {
      await switchNetwork(connection, network);
      const from = connection.address;
      const target = await resolveAddress(
        kind === "addition" ? newOwner : recipient,
      );
      const p =
        kind === "addition"
          ? await previewAddition(network, rpc, snapshot, from, target.address)
          : await previewRecovery(
              network,
              rpc,
              snapshot,
              from,
              recipientAddress(target.address, snapshot.wallet),
              selectedAssets.map((asset) => ({
                asset,
                amount: amountFor(asset, selected[asset.key]),
              })),
            );
      const accounts = await connection.provider.request({
        method: "eth_accounts",
      });
      if (
        !accounts?.[0] ||
        !same(accounts[0], from) ||
        Number(await connection.provider.request({ method: "eth_chainId" })) !==
          chainId
      )
        throw Error(
          "Connected account or chain changed during review. Review again.",
        );
      p.resolvedTargets = [target];
      setPreview(p);
      setAck(false);
      setConfirmedRecipient("");
    } catch (e) {
      notify(errorText(e));
      setReviewError(errorText(e));
    } finally {
      taskLock.current = false;
      setBusy("");
    }
  }
  async function execute() {
    if (!preview || !connection || taskLock.current || activePending) return;
    taskLock.current = true;
    setBusy("signing");
    setReviewError("");
    const p = preview;
    try {
      const hash = await submit(
        connection,
        network,
        rpc,
        p,
        setTxStatus,
        (id, mode) =>
          savePending({
            id,
            mode,
            chainId,
            wallet: p.snapshot.wallet,
            actor: p.actor,
            kind: p.kind,
            createdAt: Date.now(),
          }),
      );
      setTxHash(hash);
      setTxStatus("Confirmed. Checking owners and holdings…");
      const after = await inspect(network, p.snapshot.wallet, rpc);
      setSnapshot(after);
      setChains((x) => ({
        ...x,
        [chainId]: {
          status: after.verified ? "verified" : "unsupported",
          snapshot: after,
        },
      }));
      let postCheckError = "";
      try {
        if (p.kind === "addition")
          assertAddition(p.snapshot, after, p.newOwner!);
        else assertSameOwners(p.snapshot, after);
      } catch (e) {
        postCheckError = errorText(e);
      }
      const tokens = assets.filter(
        (a) => a.kind !== "native" && a.kind !== "deposit",
      );
      let failed = 0;
      const refreshed = await Promise.all(
        tokens.map(async (a) => {
          try {
            return {
              ...a,
              balance: await holding(clientFor(network, rpc), after.wallet, a),
            };
          } catch {
            failed++;
            return {
              ...a,
              warning:
                "Balance refresh failed. Inspect this token before another transfer.",
            };
          }
        }),
      );
      setAssets([...baseAssets(after, network), ...refreshed]);
      setSelected({});
      savePending(null);
      if (postCheckError) {
        setReviewError(
          "Transaction confirmed, but the owner verification needs attention: " +
            postCheckError,
        );
        setTxStatus("Confirmed — owner verification needs attention.");
        return;
      }
      let transferWarnings: string[] = [];
      if (p.kind === "recovery")
        for (const x of p.selections!) {
          if (x.asset.kind === "native") {
            if (after.native > p.snapshot.native - x.amount)
              transferWarnings.push("Native currency");
            continue;
          }
          if (x.asset.kind === "deposit") {
            if (
              after.deposit === null ||
              after.deposit > (p.snapshot.deposit ?? 0n) - x.amount
            )
              transferWarnings.push("EntryPoint deposit");
            continue;
          }
          const a = refreshed.find((a) => a.key === x.asset.key);
          if (!a || a.warning || a.balance > x.asset.balance - x.amount)
            transferWarnings.push(x.asset.symbol);
          if (x.asset.kind === "erc721")
            try {
              const owner = await clientFor(network, rpc).readContract({
                address: x.asset.contract!,
                abi: tokenAbi,
                functionName: "ownerOf",
                args: [x.asset.tokenId!],
              });
              if (!same(owner, p.recipient!))
                transferWarnings.push(x.asset.symbol);
            } catch {
              transferWarnings.push(x.asset.symbol);
            }
        }
      setTxStatus(
        p.kind === "addition"
          ? "Confirmed. New owner added; every original owner is unchanged."
          : transferWarnings.length || failed
            ? "Confirmed. Owners are unchanged; some asset balances need manual verification."
            : "Confirmed. Owners are unchanged and selected token debits were checked.",
      );
      if (transferWarnings.length || failed)
        setReviewError(
          "Check these holdings and the recipient balances: " +
            [...new Set(transferWarnings)].join(", ") +
            (failed ? ` (${failed} balance lookups failed)` : "") +
            ". Token fees or nonstandard behavior can affect received amounts.",
        );
      notify(
        p.kind === "addition"
          ? "Backup owner added. Original owners verified unchanged."
          : "Batch confirmed. Review the post-transaction checks below.",
      );
    } catch (e) {
      setReviewError(errorText(e));
      setTxStatus(
        pendingRef.current
          ? "Check submitted transaction status before retrying."
          : "Transaction did not complete. Check wallet activity if you already signed.",
      );
    } finally {
      taskLock.current = false;
      setBusy("");
    }
  }
  async function checkPending() {
    if (!pending || taskLock.current) return;
    taskLock.current = true;
    setBusy("confirmation");
    try {
      const n = NETWORKS.find((n) => n.chain.id === pending.chainId)!;
      let hash: Hex;
      if (pending.mode === "calls") {
        if (!connection)
          throw Error(
            "Connect the smart wallet that submitted this call to check its status.",
          );
        const r = await connection.provider.request({
          method: "wallet_getCallsStatus",
          params: [pending.id],
        });
        if (typeof r.status === "number" && r.status >= 400)
          throw Error(
            "Wallet reported a failed operation. Check wallet activity.",
          );
        hash = r.receipts?.[0]?.transactionHash;
        if (!hash)
          throw Error("Still pending; no transaction receipt is available.");
      } else hash = pending.id as Hex;
      const receipt = await clientFor(
        n,
        rpcOverrides[n.chain.id],
      ).getTransactionReceipt({ hash });
      if (receipt.status === "reverted") {
        savePending(null);
        notify("The submitted transaction reverted. Gas may have been spent.");
        return;
      }
      try {
        assertExecutionReceipt(
          receipt,
          pending.actor || pending.wallet,
          trusted.entryPoint as Address,
        );
      } catch (e) {
        savePending(null);
        notify(
          errorText(e) + " Refresh owners and holdings before another action.",
        );
        return;
      }
      if (
        (await clientFor(n, rpcOverrides[n.chain.id]).getBlockNumber()) <
        receipt.blockNumber + 1n
      )
        throw Error("Waiting for a second confirmation.");
      savePending(null);
      setTxHash(hash);
      notify(
        "Transaction confirmed. Refresh owners and holdings before another action.",
      );
    } catch (e) {
      notify(errorText(e));
    } finally {
      taskLock.current = false;
      setBusy("");
    }
  }
  const routeLabel =
    preview?.route === "eoa"
      ? "Registered EOA · pays its own gas"
      : preview?.route === "self"
        ? "Smart wallet · connected passkey/account"
        : "Connected contract owner · authorizes through its wallet";
  const connectedIdentity = (
    <div className="settings-row connected-identity">
      {connection ? (
        <>
          <span className="small muted">Connected account</span>
          <AddressLine value={connection.address} />
          <p className="section-note">
            {connectedAuthorized
              ? same(actor, snapshot?.wallet || "")
                ? "This smart wallet will authorize using its connected wallet provider."
                : snapshot?.owners.find(
                      (o) => o.address && same(o.address, actor),
                    )?.isContract
                  ? "This contract owner authorizes through its wallet provider. Safe exports are also available."
                  : "This registered owner authorizes the action and pays gas from its own balance."
              : "Connect this smart wallet or one of its registered owners to authorize actions."}
          </p>
        </>
      ) : (
        <button
          className="button"
          onClick={() => {
            setConnectError("");
            setConnectOpen(true);
          }}
        >
          <Wallet size={16} />
          Connect an owner to continue
        </button>
      )}
    </div>
  );
  return (
    <div className="shell">
      <aside>
        <a className="brand" href="/">
          <Wallet />
          Manager
        </a>
        <div className="aside-label">SMART WALLET</div>
        <nav aria-label="Workspace navigation">
          {(
            [
              ["owners", Users, "Owners & access"],
              ["recovery", Layers, "Asset recovery"],
              ["checks", ShieldCheck, "Contract checks"],
              ["settings", Settings2, "Connections"],
            ] as const
          ).map(([id, Icon, label]) => (
            <button
              key={id}
              className={page === id ? "active" : ""}
              onClick={() => setPage(id)}
            >
              <Icon />
              {label}
            </button>
          ))}
        </nav>
        <div className="aside-foot">
          Your keys stay in your wallet.
          <br />
          Every transaction needs your signature.
        </div>
      </aside>
      <main>
        <header>
          <span className="flex">
            <span className="tag">{network.chain.name}</span>
            <span>Wallet workspace</span>
          </span>
          <div className="flex">
            {connection ? (
              <>
                <AddressLine value={connection.address} compact />
                <button
                  className="button"
                  disabled={!!busy}
                  onClick={disconnectWallet}
                >
                  Disconnect
                </button>
              </>
            ) : (
              <button
                className="button"
                disabled={!!busy}
                onClick={() => setConnectOpen(true)}
              >
                <Wallet size={16} />
                Connect wallet
              </button>
            )}
          </div>
        </header>
        <section className="page-heading">
          <div className="eyebrow">{titles[page][0]}</div>
          <h1>{titles[page][1]}</h1>
          <p>{titles[page][2]}</p>
        </section>
        <section className="card wallet-bar">
          <div>
            <label htmlFor="wallet-address">
              Smart wallet address or ENS name
            </label>
            <input
              id="wallet-address"
              spellCheck={false}
              value={walletInput}
              disabled={!!busy}
              onChange={(e) => editWallet(e.target.value)}
            />
            <ResolutionHint value={walletInput} />
            {snapshot && <AddressLine value={snapshot.wallet} compact />}
          </div>
          <div>
            <label htmlFor="network">Network</label>
            <select
              id="network"
              value={chainId}
              disabled={!!busy}
              onChange={(e) => editChain(Number(e.target.value))}
            >
              {NETWORKS.map((n) => (
                <option key={n.chain.id} value={n.chain.id}>
                  {n.chain.name}
                </option>
              ))}
            </select>
          </div>
          <button className="button primary" disabled={!!busy} onClick={load}>
            {busy === "inspection" ? (
              <Loader2 size={16} className="spinner" />
            ) : (
              <Search size={16} />
            )}
            Inspect wallet
          </button>
        </section>
        {loadError && (
          <div role="alert" className="notice error">
            <AlertTriangle size={20} />
            <div>
              {loadError}
              <div className="small">
                Check the address and network, or try your own RPC in
                Connections.
              </div>
            </div>
          </div>
        )}
        {busy && busy !== "signing" && (
          <div role="status" className="notice progress-banner">
            <Loader2 className="spinner" size={18} />
            <div>
              {busy === "simulation"
                ? "Simulating calls and comparing owner snapshots…"
                : busy === "asset discovery"
                  ? "Discovering tokens and NFTs, then checking their holdings on-chain…"
                  : busy === "chain scan"
                    ? "Checking deployments across ten networks…"
                    : busy === "transfer scan"
                      ? txStatus
                      : `Working on ${busy}…`}
            </div>
          </div>
        )}
        {snapshot && !snapshot.verified && (
          <div className="notice error">
            <AlertTriangle size={20} />
            <div>
              <strong>Unrecognized bytecode. Transactions are disabled.</strong>{" "}
              You can inspect records, but this implementation has not been
              reviewed by this tool.
            </div>
          </div>
        )}
        {connection && snapshot && !connectedAuthorized && (
          <div className="notice warning">
            <AlertTriangle size={20} />
            <div>
              The connected account is not an owner of this wallet on{" "}
              {network.chain.name}. You can inspect; connect a registered owner
              or this smart wallet to authorize actions.
            </div>
          </div>
        )}
        {pending && (
          <div className="notice warning">
            <RefreshCw size={20} />
            <div>
              <strong>
                A submitted {pending.kind} needs a confirmation check.
              </strong>
              <div className="mono">
                Chain {pending.chainId} · {pending.id}
              </div>
              <p className="small">
                Check its status before submitting another transaction for this
                wallet and chain.
              </p>
              <button
                className="button"
                disabled={!!busy}
                onClick={checkPending}
              >
                Check confirmation
              </button>
            </div>
          </div>
        )}
        {page === "owners" && (
          <>
            <div className="notice">
              <ShieldCheck size={20} />
              <div>
                <strong>Additions only.</strong> This tool has no owner-removal
                or upgrade action. Each new owner gets full control, including
                the ability to remove other owners.
              </div>
            </div>
            {snapshot && (
              <div className="status-strip">
                <div className="metric">
                  <label>Existing owners</label>
                  <div className="value">{snapshot.count.toString()}</div>
                </div>
                <div className="metric">
                  <label>Contract match</label>
                  <div className="value text">
                    {snapshot.verified ? "Reviewed bytecode" : "Unrecognized"}
                  </div>
                </div>
                <div className="metric">
                  <label>Read at block</label>
                  <div className="value text">
                    {snapshot.block.toLocaleString()}
                  </div>
                </div>
              </div>
            )}
            <section className="card">
              <div className="card-head">
                <h2>Current owners</h2>
                <div className="flex">
                  <span className="tag">Live on-chain reads</span>
                  {snapshot && (
                    <button
                      className="icon-button"
                      title="Export owner snapshot"
                      onClick={() =>
                        download(`owner-snapshot-${chainId}.json`, snapshot)
                      }
                    >
                      <Download size={18} />
                    </button>
                  )}
                </div>
              </div>
              {snapshot ? (
                snapshot.owners.map((o) => (
                  <div className="owner-row" key={o.index}>
                    <div className="owner-icon">
                      {o.kind === "passkey" ? (
                        <KeyRound size={20} />
                      ) : o.isContract ? (
                        <Building2 size={20} />
                      ) : (
                        <Wallet size={20} />
                      )}
                    </div>
                    <div className="owner-content">
                      <strong>
                        {o.kind === "passkey"
                          ? "Passkey public key"
                          : o.isContract
                            ? "Smart contract owner"
                            : o.kind === "address"
                              ? "Address owner"
                              : "Unknown owner encoding"}{" "}
                        {o.address &&
                          connection &&
                          same(o.address, connection.address) && (
                            <span className="tag">Connected</span>
                          )}
                      </strong>
                      {o.address ? (
                        <AddressLine value={o.address} onCopy={copy} />
                      ) : (
                        <>
                          <span className="small muted">
                            P-256 / WebAuthn · stored public key
                          </span>
                          <details>
                            <summary className="small link">
                              View public key bytes
                            </summary>
                            <div className="mono long-value">{o.bytes}</div>
                          </details>
                        </>
                      )}
                      <div className="section-note">
                        {o.kind === "passkey"
                          ? "Public keys identify existing passkeys. This site does not import or recreate those passkeys."
                          : o.isContract
                            ? "Calls must originate from this contract, or use its valid contract signature."
                            : "This owner can call the smart wallet directly."}
                      </div>
                    </div>
                    <span className="owner-index">Index {o.index}</span>
                  </div>
                ))
              ) : (
                <div className="empty">
                  <Users size={28} />
                  <div>Inspect the wallet to load its owners.</div>
                </div>
              )}
            </section>
            <div className="two-col">
              <section className="card">
                <h2>Add a backup owner</h2>
                <p className="muted small">
                  Add an EOA or a multisig contract. The transaction appends one
                  owner on {network.chain.name}.
                </p>
                {connectedIdentity}
                <label htmlFor="new-owner">New owner address or ENS name</label>
                <input
                  id="new-owner"
                  spellCheck={false}
                  placeholder="0x… or name.eth"
                  value={newOwner}
                  disabled={!!busy}
                  onChange={(e) => {
                    setNewOwner(e.target.value);
                    clearPreview();
                  }}
                />
                <ResolutionHint value={newOwner} />
                <button
                  className="button primary"
                  disabled={!canReview || !newOwner || !actor}
                  onClick={() => review("addition")}
                >
                  <Plus size={16} />
                  Review addition
                </button>
                <p className="section-note">
                  Connect an existing owner to sign, or export for a multisig.
                  Verify the new address is under your control before adding it.
                </p>
              </section>
              <section className="card dark-card">
                <ShieldCheck size={30} />
                <h2>Keep your original access.</h2>
                <p>
                  Every existing owner is compared before signing and again
                  after confirmation. The addition uses a chain-specific call.
                </p>
                <p>
                  Repeat the addition separately on each chain. Matching wallet
                  addresses do not guarantee matching owner lists.
                </p>
                <a href={trusted.sourceUrl} target="_blank" rel="noreferrer">
                  Read the deployed source <ArrowUpRight size={16} />
                </a>
              </section>
            </div>
            <section className="card">
              <div className="card-head">
                <h2>Wallet across chains</h2>
                <button
                  className="button"
                  disabled={!!busy}
                  onClick={scanChains}
                >
                  <ScanLine size={16} />
                  Check all chains
                </button>
              </div>
              <div className="chain-grid">
                {NETWORKS.map((n) => {
                  const r = chains[n.chain.id];
                  return (
                    <button
                      key={n.chain.id}
                      className={`chain-card ${chainId === n.chain.id ? "selected" : ""}`}
                      disabled={!!busy}
                      onClick={() => editChain(n.chain.id)}
                    >
                      <div className="chain-title flex">
                        <span style={{ color: n.color }}>●</span>
                        {n.chain.name}
                        <span className="small muted">{n.chain.id}</span>
                      </div>
                      <p>
                        {!r
                          ? "Not checked"
                          : r.status === "checking"
                            ? "Checking…"
                            : r.status === "verified"
                              ? `${r.snapshot!.count} owners · reviewed bytecode`
                              : r.status === "absent"
                                ? "No deployed wallet"
                                : r.status === "unsupported"
                                  ? "Unrecognized implementation"
                                  : "RPC check failed — retry or change endpoint"}
                      </p>
                      {r?.snapshot && (
                        <p>
                          {formatUnits(r.snapshot.native, 18).slice(0, 12)}{" "}
                          {n.chain.nativeCurrency.symbol} · wallet balance
                        </p>
                      )}
                    </button>
                  );
                })}
              </div>
            </section>
          </>
        )}
        {page === "recovery" && (
          <>
            <div className="notice warning">
              <AlertTriangle size={20} />
              <div>
                Asset discovery can be incomplete. Token names are untrusted.
                Verify contract addresses before selecting assets; import
                anything missing.
              </div>
            </div>
            <div className="recovery-layout">
              <div>
                <section className="card">
                  <div className="card-head">
                    <h2>Assets on {network.chain.name}</h2>
                    <span className="tag">
                      {assets.filter((a) => a.balance > 0n).length} holdings
                      loaded
                    </span>
                  </div>
                  <div className="asset-toolbar">
                    <div className="flex">
                      <button
                        className="button"
                        disabled={!snapshot || !!busy}
                        onClick={discoverAssets}
                      >
                        <RefreshCw size={15} />
                        Discover assets
                      </button>
                      <button
                        className="button"
                        disabled={!snapshot || !!busy}
                        onClick={() => {
                          setImportOpen(true);
                          setImportError("");
                        }}
                      >
                        <Plus size={15} />
                        Import token
                      </button>
                    </div>
                    <button
                      className="button"
                      disabled={!snapshot || !!busy}
                      onClick={() => {
                        setScanOpen(true);
                        setImportError("");
                      }}
                    >
                      <ScanLine size={15} />
                      Scan transfers
                    </button>
                  </div>
                  <p className="section-note" role="status">
                    {assetNote}
                  </p>
                  {snapshot?.depositError && (
                    <p className="section-note">{snapshot.depositError}</p>
                  )}
                  <input
                    aria-label="Search assets"
                    placeholder="Search token, contract or token ID"
                    value={assetFilter}
                    onChange={(e) => setAssetFilter(e.target.value)}
                  />
                  <div className="table-scroll">
                    <table className="asset-table">
                      <thead>
                        <tr>
                          <th>
                            <input
                              aria-label="Select all visible holdings"
                              type="checkbox"
                              disabled={!!busy}
                              checked={
                                visibleAssets.filter(
                                  (a) => a.balance > 0n && !a.warning,
                                ).length > 0 &&
                                visibleAssets
                                  .filter((a) => a.balance > 0n && !a.warning)
                                  .every((a) => selected[a.key] !== undefined)
                              }
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelected((old) => ({
                                    ...old,
                                    ...Object.fromEntries(
                                      visibleAssets
                                        .filter(
                                          (a) => a.balance > 0n && !a.warning,
                                        )
                                        .map((a) => [
                                          a.key,
                                          a.kind === "erc721"
                                            ? "1"
                                            : (a.kind === "native" ||
                                                  a.kind === "deposit") &&
                                                same(
                                                  actor,
                                                  snapshot?.wallet || "",
                                                )
                                              ? ""
                                              : formatUnits(
                                                  a.balance,
                                                  a.decimals,
                                                ),
                                        ]),
                                    ),
                                  }));
                                } else
                                  setSelected((old) =>
                                    Object.fromEntries(
                                      Object.entries(old).filter(
                                        ([key]) =>
                                          !visibleAssets.some(
                                            (a) => a.key === key,
                                          ),
                                      ),
                                    ),
                                  );
                              }}
                            />
                          </th>
                          <th>ASSET</th>
                          <th>BALANCE</th>
                          <th>TRANSFER AMOUNT</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleAssets.map((a) => (
                          <tr key={a.key}>
                            <td>
                              <input
                                type="checkbox"
                                aria-label={`Select ${a.symbol}${a.tokenId !== undefined ? " #" + a.tokenId : ""}`}
                                disabled={
                                  !!busy || a.balance === 0n || !!a.warning
                                }
                                checked={selected[a.key] !== undefined}
                                onChange={(e) =>
                                  setSelected((old) => {
                                    const next = { ...old };
                                    if (e.target.checked)
                                      next[a.key] =
                                        a.kind === "erc721"
                                          ? "1"
                                          : (a.kind === "native" ||
                                                a.kind === "deposit") &&
                                              same(
                                                actor,
                                                snapshot?.wallet || "",
                                              )
                                            ? ""
                                            : formatUnits(
                                                a.balance,
                                                a.decimals,
                                              );
                                    else delete next[a.key];
                                    return next;
                                  })
                                }
                              />
                            </td>
                            <td>
                              <div className="asset-identity">
                                <span className="token-icon">
                                  {a.kind === "deposit" ? (
                                    <ShieldCheck size={17} />
                                  ) : a.kind === "erc721" ||
                                    a.kind === "erc1155" ? (
                                    <Layers size={17} />
                                  ) : (
                                    a.symbol.slice(0, 3)
                                  )}
                                </span>
                                <div>
                                  <div className="asset-title">
                                    {a.symbol}
                                    {a.tokenId !== undefined && (
                                      <span className="small">
                                        {" "}
                                        #{a.tokenId.toString()}
                                      </span>
                                    )}
                                  </div>
                                  <div className="asset-sub">
                                    {a.name} · {a.kind.toUpperCase()}
                                  </div>
                                  {a.contract && (
                                    <a
                                      className="mono link small"
                                      target="_blank"
                                      rel="noreferrer"
                                      href={`${network.chain.blockExplorers!.default.url}/address/${a.contract}`}
                                    >
                                      {short(a.contract)}
                                    </a>
                                  )}
                                  {a.warning && (
                                    <div
                                      className="small"
                                      style={{ color: "#913c34" }}
                                    >
                                      {a.warning}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </td>
                            <td title={formatUnits(a.balance, a.decimals)}>
                              {displayBalance(a)}
                            </td>
                            <td className="amount-cell">
                              {selected[a.key] !== undefined ? (
                                <input
                                  className="amount"
                                  aria-label={`Transfer amount ${a.key}`}
                                  value={selected[a.key]}
                                  disabled={!!busy || a.kind === "erc721"}
                                  placeholder="Amount"
                                  onChange={(e) =>
                                    setSelected((old) => ({
                                      ...old,
                                      [a.key]: e.target.value,
                                    }))
                                  }
                                />
                              ) : (
                                <span className="muted">—</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {assets.length === 0 && (
                    <div className="empty">
                      <Layers size={28} />
                      <div>Inspect the wallet to load balances.</div>
                    </div>
                  )}
                </section>
                <p className="footer-note">
                  Native currency is separate from the EntryPoint deposit.
                  ERC-721 and ERC-1155 transfers use receiver checks. ERC-20
                  return values are checked during simulation; unusual tokens
                  can still require manual balance verification.
                </p>
              </div>
              <section className="card recovery-side">
                <h2>Recovery destination</h2>
                <div className="selected-count">
                  {selectedAssets.length}
                  <span>assets selected</span>
                </div>
                {connectedIdentity}
                <label htmlFor="recipient-owner">Use an address owner</label>
                <select
                  id="recipient-owner"
                  disabled={!!busy}
                  value={
                    snapshot?.owners.some(
                      (o) => o.address && same(o.address, recipient),
                    )
                      ? recipient
                      : ""
                  }
                  onChange={(e) => {
                    setRecipient(e.target.value);
                    clearPreview();
                  }}
                >
                  <option value="">Custom recipient</option>
                  {snapshot?.owners
                    .filter((o) => o.address)
                    .map((o) => (
                      <OwnerOption
                        key={o.index}
                        address={o.address!}
                        index={o.index}
                      />
                    ))}
                </select>
                <label htmlFor="recipient">Recipient address or ENS name</label>
                <input
                  id="recipient"
                  spellCheck={false}
                  placeholder="0x… or name.eth"
                  value={recipient}
                  disabled={!!busy}
                  onChange={(e) => {
                    setRecipient(e.target.value);
                    clearPreview();
                  }}
                />
                <ResolutionHint value={recipient} />
                <button
                  className="button primary"
                  disabled={
                    !canReview || !selectedAssets.length || !recipient || !actor
                  }
                  onClick={() => review("recovery")}
                >
                  Review batch transfer
                </button>
                <p>
                  {actor && same(actor, snapshot?.wallet || "")
                    ? "Leave gas reserves when submitting through this smart wallet. A registered external EOA can recover full balances while paying gas separately."
                    : "A registered external EOA pays gas separately, so native currency and prepaid gas can be fully recovered."}
                </p>
                <p>
                  One chain per batch. Reverting calls roll back the batch. A
                  false-returning token does not automatically revert; the
                  simulation checks it first.
                </p>
              </section>
            </div>
          </>
        )}
        {page === "checks" && (
          <>
            <section className="card">
              <div className="card-head">
                <h2>Deployed-code verification</h2>
                <span className="tag">
                  {snapshot?.verified ? (
                    <CheckCircle2 size={14} />
                  ) : (
                    <ShieldCheck size={14} />
                  )}{" "}
                  {snapshot?.verified ? "Bytecode matches" : "Inspect to check"}
                </span>
              </div>
              <p className="muted">
                The tool compares the proxy, implementation and EntryPoint
                runtime code with pinned hashes. It also checks the ERC-1967
                storage slot against the implementation getter. Unknown wallet
                bytecode blocks all transactions.
              </p>
              <dl className="details-grid">
                <dt>Wallet</dt>
                <dd>
                  <AddressLine
                    value={snapshot?.wallet || walletInput}
                    onCopy={copy}
                  />
                </dd>
                <dt>Implementation</dt>
                <dd>
                  <AddressLine
                    value={snapshot?.implementation || trusted.implementation}
                    onCopy={copy}
                  />
                </dd>
                <dt>Implementation hash</dt>
                <dd className="mono">
                  {snapshot?.implementationHash || trusted.implementationHash}
                </dd>
                <dt>Proxy hash</dt>
                <dd className="mono">
                  {snapshot?.proxyHash || trusted.proxyHash}
                </dd>
                <dt>EntryPoint</dt>
                <dd className="mono">
                  {snapshot?.entryPoint || trusted.entryPoint}
                </dd>
                <dt>EntryPoint deposit</dt>
                <dd>
                  {snapshot?.deposit !== null && snapshot?.deposit !== undefined
                    ? `${formatUnits(snapshot.deposit, 18)} ${network.chain.nativeCurrency.symbol}`
                    : "Not read"}
                </dd>
                <dt>EntryPoint stake</dt>
                <dd>
                  {snapshot?.stake !== null && snapshot?.stake !== undefined
                    ? `${formatUnits(snapshot.stake, 18)} ${network.chain.nativeCurrency.symbol} · separate from the spendable deposit`
                    : "Not read"}
                </dd>
                <dt>Snapshot block</dt>
                <dd>{snapshot?.block.toString() || "Not read"}</dd>
              </dl>
              {snapshot && (
                <button
                  className="button"
                  onClick={() =>
                    download(`wallet-verification-${chainId}.json`, snapshot)
                  }
                >
                  <Download size={16} />
                  Export live snapshot
                </button>
              )}
            </section>
            <div className="two-col">
              <section className="card">
                <h2>Source reproduced independently</h2>
                <p>
                  {compilation.exactRuntimeMatch
                    ? "The verified implementation source was compiled with Solidity 0.8.23 and the explorer’s settings. After applying the deployment’s documented immutable address, the full runtime bytecode matches exactly."
                    : "Compilation evidence is available in the project. The tool pins the explorer-verified runtime bytecode."}
                </p>
                <dl className="details-grid">
                  <dt>Compiler</dt>
                  <dd className="mono">{compilation.compiler}</dd>
                  <dt>Runtime match</dt>
                  <dd>
                    {compilation.exactRuntimeMatch
                      ? "Exact match"
                      : "See compilation report"}
                  </dd>
                  <dt>Reviewed</dt>
                  <dd>{new Date(trusted.checkedAt).toLocaleDateString()}</dd>
                </dl>
                <p className="section-note">
                  This is a source and bytecode review, not a formal security
                  audit. RPC and explorer services remain trust dependencies.
                </p>
              </section>
              <section className="card">
                <h2>What the tool will authorize</h2>
                <ul className="help-list">
                  <li>
                    One appended address owner, preserving all current owner
                    entries.
                  </li>
                  <li>
                    A recovery batch containing only selected asset transfers
                    and deposit withdrawals.
                  </li>
                  <li>
                    Chain-specific transactions with zero native value on the
                    outer call.
                  </li>
                </ul>
                <p className="small muted">
                  No owner removal, reinitialization, upgrade, allowance
                  approvals, arbitrary calldata editor, or replayable
                  cross-chain owner change.
                </p>
              </section>
            </div>
            <section className="card sources">
              <h2>Source references</h2>
              <a href={trusted.sourceUrl} target="_blank" rel="noreferrer">
                Verified deployed implementation on Ethereum{" "}
                <ExternalLink size={14} />
              </a>
              <a
                href="https://github.com/coinbase/smart-wallet"
                target="_blank"
                rel="noreferrer"
              >
                Coinbase Smart Wallet repository <ExternalLink size={14} />
              </a>
              <a
                href="https://github.com/eth-infinitism/account-abstraction/blob/v0.6.0/contracts/core/StakeManager.sol"
                target="_blank"
                rel="noreferrer"
              >
                EntryPoint v0.6 deposit withdrawal logic{" "}
                <ExternalLink size={14} />
              </a>
              <a
                href={`https://www.contractreader.io/contract/mainnet/${walletInput}`}
                target="_blank"
                rel="noreferrer"
              >
                Inspect wallet with ContractReader <ExternalLink size={14} />
              </a>
            </section>
          </>
        )}
        {page === "settings" && (
          <>
            <section className="card">
              <h2>RPC connection</h2>
              <p className="muted small">
                Default endpoint for {network.chain.name}:{" "}
                <span className="mono">{network.rpc}</span>
              </p>
              <div className="inline-field">
                <div>
                  <label htmlFor="custom-rpc">
                    Custom RPC URL for {network.chain.name}
                  </label>
                  <input
                    id="custom-rpc"
                    type="url"
                    placeholder="https://…"
                    value={rpcDraft}
                    disabled={!!busy}
                    onChange={(e) => setRpcDraft(e.target.value)}
                  />
                </div>
                <button
                  className="button primary"
                  disabled={!!busy}
                  onClick={() => {
                    try {
                      clientFor(network, rpcDraft || undefined);
                      invalidate();
                      setRpcOverrides((old) => ({
                        ...old,
                        [chainId]: rpcDraft,
                      }));
                      notify(
                        "RPC updated. Inspect the wallet again to verify the chain and code.",
                      );
                    } catch (e) {
                      notify(errorText(e));
                    }
                  }}
                >
                  Apply endpoint
                </button>
              </div>
              <p className="section-note">
                Custom endpoints are kept only in this page’s memory. RPC
                providers can see queried addresses; use a provider you trust.
                API keys entered in a browser URL are visible to this browser.
              </p>
            </section>
            <section className="card">
              <h2>Wallet connection</h2>
              <p>
                {connection ? (
                  <>
                    <span>{connection.name}</span>
                    <AddressLine value={connection.address} onCopy={copy} />
                  </>
                ) : (
                  "No wallet connected. Read-only inspection works without connecting."
                )}
              </p>
              <button
                className="button"
                disabled={!!busy}
                onClick={() => setConnectOpen(true)}
              >
                <Wallet size={16} />
                Choose a wallet
              </button>
              <p className="section-note">
                Browser wallets use injected providers. Coinbase Smart Wallet
                uses its official SDK and existing passkey access. The site
                never asks for seed phrases or private keys.
              </p>
            </section>
            <section className="card">
              <h2>Multisig owners</h2>
              <p>
                Add the deployed multisig’s address as an owner on each chain.
                To authorize an addition or recovery through it, connect the
                multisig account (rather than an individual signer), review the
                simulation, and sign through its wallet provider or export a
                Safe Transaction Builder JSON file.
              </p>
              <p className="muted small">
                Import the file in the multisig’s transaction builder, check the
                destination and calldata, and collect its normal threshold of
                signatures. A signer of the multisig is not automatically an
                owner of the Coinbase wallet.
              </p>
            </section>
          </>
        )}
        {reviewError && !preview && (
          <div className="notice error" role="alert">
            <AlertTriangle size={20} />
            {reviewError}
          </div>
        )}
        <footer className="footer-note">
          Reserve · Coinbase Smart Wallet management. Read-only until you
          explicitly sign.{" "}
          {snapshot &&
            `Snapshot read ${new Date(snapshot.checkedAt).toLocaleTimeString()} UTC at block ${snapshot.block}.`}
        </footer>
      </main>
      {connectOpen && (
        <Modal
          title="Connect an owner"
          close={() => setConnectOpen(false)}
          locked={!!busy}
        >
          <p className="muted small">
            Choose an existing address owner, or connect the smart wallet with
            its original passkey provider.
          </p>
          {providers.map((p) => (
            <button
              key={p.uuid}
              className="button"
              style={{ width: "100%", marginBottom: 12 }}
              disabled={!!busy}
              onClick={() => openConnection(p)}
            >
              <Wallet size={18} />
              {p.name}
            </button>
          ))}
          <button
            className="button primary"
            style={{ width: "100%" }}
            disabled={!!busy}
            onClick={() =>
              openConnection({
                name: "Coinbase / Base Account",
                uuid: "coinbase-sdk",
                provider: coinbaseProvider(),
              })
            }
          >
            <KeyRound size={18} />
            Coinbase / Base Account
          </button>
          {connectError && (
            <div role="alert" className="notice error">
              {connectError}
            </div>
          )}
          {!providers.length && (
            <p className="section-note">
              No injected wallet detected. Use a wallet extension, a wallet’s
              browser, or Coinbase / Base Account above.
            </p>
          )}
          <p className="section-note">
            Connecting does not submit a transaction. Use your existing smart
            wallet in the Coinbase / Base Account popup. Allow popups for this
            site. A network switch is requested before review if needed.
          </p>
        </Modal>
      )}
      {importOpen && (
        <Modal
          title="Import a token or NFT"
          close={() => setImportOpen(false)}
          locked={!!busy}
        >
          <p className="muted small">
            Import on {network.chain.name}. Ownership and token type are checked
            on-chain.
          </p>
          <div className="settings-row">
            <label htmlFor="import-kind">Asset standard</label>
            <select
              id="import-kind"
              value={importKind}
              disabled={!!busy}
              onChange={(e) =>
                setImportKind(e.target.value as typeof importKind)
              }
            >
              <option value="erc20">ERC-20 token</option>
              <option value="erc721">ERC-721 NFT</option>
              <option value="erc1155">ERC-1155 NFT / token</option>
            </select>
          </div>
          <div className="settings-row">
            <label htmlFor="import-contract">
              Contract address or ENS name
            </label>
            <input
              id="import-contract"
              placeholder="0x… or name.eth"
              value={importAddress}
              disabled={!!busy}
              onChange={(e) => setImportAddress(e.target.value)}
            />
            <ResolutionHint value={importAddress} />
          </div>
          {importKind !== "erc20" && (
            <div className="settings-row">
              <label htmlFor="import-id">Token ID (decimal)</label>
              <input
                id="import-id"
                inputMode="numeric"
                placeholder="0"
                value={importId}
                disabled={!!busy}
                onChange={(e) => setImportId(e.target.value)}
              />
            </div>
          )}
          {importError && (
            <p className="notice error" role="alert">
              {importError}
            </p>
          )}
          <div className="review-footer">
            <button
              className="button primary"
              disabled={
                !!busy ||
                !importAddress ||
                (importKind !== "erc20" && !/^\d+$/.test(importId))
              }
              onClick={doImport}
            >
              Verify and import
            </button>
          </div>
        </Modal>
      )}
      {scanOpen && (
        <Modal
          title="Discover from transfer events"
          close={() => setScanOpen(false)}
          locked={!!busy}
        >
          <p className="muted small">
            Scan incoming ERC-20, ERC-721 and ERC-1155 transfers using your RPC,
            then check current holdings. This works without an asset indexer.
            Each scan covers at most 100,000 blocks.
          </p>
          <div className="two-col">
            <div>
              <label htmlFor="from-block">First block</label>
              <input
                id="from-block"
                value={scanFrom}
                disabled={!!busy}
                onChange={(e) => setScanFrom(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="to-block">Last block</label>
              <input
                id="to-block"
                value={scanTo}
                disabled={!!busy}
                onChange={(e) => setScanTo(e.target.value)}
              />
            </div>
          </div>
          <p className="section-note">
            Start at the wallet’s deployment block and repeat ranges for full
            historical coverage. The default covers recent blocks only.
            Nonstandard tokens may not emit standard events.
          </p>
          {importError && <p className="notice error">{importError}</p>}
          {busy === "transfer scan" && <p role="status">{txStatus}</p>}
          <div className="review-footer">
            <button
              className="button primary"
              disabled={
                !!busy || !/^\d+$/.test(scanFrom) || !/^\d+$/.test(scanTo)
              }
              onClick={doScan}
            >
              Scan range
            </button>
          </div>
        </Modal>
      )}
      {preview && (
        <Modal
          title={
            preview.kind === "addition"
              ? "Review backup owner addition"
              : "Review batch recovery"
          }
          close={clearPreview}
          wide
          locked={signing}
        >
          <div className="notice success">
            <CheckCircle2 size={19} />
            <div>
              Simulation passed. Proxy and implementation match the reviewed
              code. Every current owner was compared.
            </div>
          </div>
          <dl className="details-grid">
            <dt>Network</dt>
            <dd>
              {network.chain.name} · chain {preview.snapshot.chainId}
            </dd>
            <dt>Smart wallet</dt>
            <dd>
              <AddressLine value={preview.snapshot.wallet} onCopy={copy} />
            </dd>
            <dt>Authorizing account</dt>
            <dd>
              <AddressLine value={preview.actor} onCopy={copy} />
              <div className="section-note">{routeLabel}</div>
            </dd>
            <dt>Outer value</dt>
            <dd>0 {network.chain.nativeCurrency.symbol}</dd>
            <dt>Fee estimate</dt>
            <dd>{feeLabel(preview, network)}</dd>
            {preview.kind === "addition" ? (
              <>
                <dt>New owner</dt>
                <dd>
                  {preview.resolvedTargets?.[0]?.name && (
                    <div className="ens-name">
                      {preview.resolvedTargets[0].name}
                    </div>
                  )}
                  <AddressLine value={preview.newOwner!} onCopy={copy} />
                </dd>
                <dt>Owner change</dt>
                <dd>
                  {preview.snapshot.count.toString()} →{" "}
                  {(preview.snapshot.count + 1n).toString()} owners · new index{" "}
                  {preview.snapshot.nextIndex.toString()}
                </dd>
              </>
            ) : (
              <>
                <dt>Recipient</dt>
                <dd>
                  {preview.resolvedTargets?.[0]?.name && (
                    <div className="ens-name">
                      {preview.resolvedTargets[0].name}
                    </div>
                  )}
                  <AddressLine value={preview.recipient!} onCopy={copy} />
                </dd>
                <dt>Owner change</dt>
                <dd>None</dd>
              </>
            )}
          </dl>
          {preview.selections?.map((x) => (
            <div className="review-item" key={x.asset.key}>
              <strong>
                {formatUnits(x.amount, x.asset.decimals)} {x.asset.symbol}
                {x.asset.tokenId !== undefined ? ` #${x.asset.tokenId}` : ""}
              </strong>
              <div className="small muted">
                {x.asset.kind === "deposit"
                  ? "Withdraw from EntryPoint to recipient"
                  : x.asset.kind === "native"
                    ? "Send from smart wallet native balance"
                    : `${x.asset.kind.toUpperCase()} · ${x.asset.contract}`}
              </div>
            </div>
          ))}
          <details style={{ marginTop: 18 }}>
            <summary className="small link">
              Exact calldata and call targets
            </summary>
            <pre
              className="mono"
              style={{
                whiteSpace: "pre-wrap",
                maxHeight: 220,
                overflow: "auto",
              }}
            >
              {json({
                to: preview.snapshot.wallet,
                value: "0",
                data: preview.data,
                calls: preview.calls,
              })}
            </pre>
          </details>
          <ul className="help-list">
            {preview.notes.map((note, i) => (
              <li key={i}>{note}</li>
            ))}
          </ul>
          <label className="check-label">
            <input
              type="checkbox"
              disabled={signing || !!txHash}
              checked={ack}
              onChange={(e) => setAck(e.target.checked)}
            />
            <span>
              {preview.kind === "addition"
                ? "I control this new owner or its multisig, understand it receives full control, and have checked its complete address."
                : "I have checked the full recipient address, selected assets and amounts. Asset transfers cannot be undone."}
            </span>
          </label>
          {preview.kind === "recovery" && (
            <div style={{ marginTop: 15 }}>
              <label htmlFor="recipient-check">
                Confirm the recipient’s last 6 characters
              </label>
              <input
                id="recipient-check"
                value={confirmedRecipient}
                disabled={signing || !!txHash}
                placeholder={preview.recipient!.slice(-6)}
                onChange={(e) => setConfirmedRecipient(e.target.value)}
              />
            </div>
          )}
          {reviewError && (
            <div
              role="alert"
              className="notice error"
              style={{ marginTop: 18 }}
            >
              <AlertTriangle size={19} />
              {reviewError}
            </div>
          )}
          {txStatus && (
            <div role="status" className="notice" style={{ marginTop: 18 }}>
              {signing ? (
                <Loader2 className="spinner" size={18} />
              ) : (
                <CheckCircle2 size={18} />
              )}
              <div>
                {txStatus}
                {txHash && (
                  <a
                    className="link mono"
                    target="_blank"
                    rel="noreferrer"
                    style={{ display: "block" }}
                    href={`${network.chain.blockExplorers!.default.url}/tx/${txHash}`}
                  >
                    View confirmed transaction
                  </a>
                )}
              </div>
            </div>
          )}
          <div className="review-footer">
            {!txHash && (
              <button
                className="button"
                disabled={
                  signing ||
                  !ack ||
                  (preview.kind === "recovery" &&
                    confirmedRecipient.toLowerCase() !==
                      preview.recipient!.slice(-6).toLowerCase())
                }
                onClick={() =>
                  download(
                    `${preview.route === "contract" ? "safe" : "preview"}-${preview.kind}-${chainId}.json`,
                    preview.route === "contract"
                      ? safeExport(preview)
                      : {
                          chainId: String(chainId),
                          from: preview.actor,
                          to: preview.snapshot.wallet,
                          value: "0",
                          data: preview.data,
                          ownerSnapshot: preview.snapshot,
                          notes: preview.notes,
                        },
                  )
                }
              >
                <Download size={16} />
                {preview.route === "contract"
                  ? "Export for multisig"
                  : "Download preview"}
              </button>
            )}
            {txHash ? (
              <button className="button primary" onClick={clearPreview}>
                Done
              </button>
            ) : connection && same(connection.address, preview.actor) ? (
              <button
                className="button primary"
                disabled={
                  signing ||
                  activePending ||
                  !ack ||
                  (preview.kind === "recovery" &&
                    confirmedRecipient.toLowerCase() !==
                      preview.recipient!.slice(-6).toLowerCase())
                }
                onClick={execute}
              >
                {signing ? (
                  <Loader2 className="spinner" size={16} />
                ) : (
                  <Wallet size={16} />
                )}
                Sign{" "}
                {preview.kind === "addition"
                  ? "owner addition"
                  : "batch transfer"}
              </button>
            ) : (
              <button
                className="button primary"
                disabled={signing}
                onClick={() => {
                  clearPreview();
                  setConnectOpen(true);
                }}
              >
                Connect authorizing account
              </button>
            )}
          </div>
          <p className="section-note">
            Owner state and call simulation are checked again immediately before
            signing. Network state can still change before mining. Exported
            transactions must be rechecked in the multisig interface.
          </p>
        </Modal>
      )}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
