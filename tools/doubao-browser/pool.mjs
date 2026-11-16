import { randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';

export const TARGET = 300;
export const RESERVE = 2;
export const MODELS = ['seedance_v2.5', 'seedance_v2.0_std', 'seedance_v2.0', 'seedance_v2.0_mini'];
const profileLabel = id => 'eggfansTV-' + id;
const usedReason = '视频已保存；清理网站数据后可重新调度';
const pendingReason = '上游已成功，等待本地视频入库及归档；暂不清理';
const terminal = job => ['success', 'failed'].includes(job.phase);
function releaseProfile(profile) {
  profile.state = 'cold';
  delete profile.taskId; delete profile.usedTaskId; delete profile.reason;
}
export function validateRequest(input) {
  if (!/^[\w-]{1,128}$/.test(input.taskId || '') || !MODELS.includes(input.model)) throw Error('任务或模型无效');
  if (typeof input.prompt !== 'string' || !input.prompt.trim() || Array.from(input.prompt).length > 8000) throw Error('提示词须为 1～8000 字符');
  if (!Number.isInteger(input.duration) || input.duration < 1 || input.duration > (input.model === 'seedance_v2.5' ? 30 : 15)) throw Error('视频时长超出当前模型范围');
  if (!['16:9', '9:16', '1:1', '4:3', '3:4'].includes(input.ratio)) throw Error('视频比例不支持');
  const validImage = value => typeof value === 'string' ? /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(value) : value && /^\.submit-[A-Za-z0-9_-]+\/\d+\.(png|jpeg|webp)$/.test(value.file || '') && ['image/png', 'image/jpeg', 'image/webp'].includes(value.mime) && Number.isSafeInteger(value.bytes) && value.bytes > 0 && /^[a-f0-9]{64}$/.test(value.sha256 || '');
  if (!Array.isArray(input.images) || input.images.length > 10 || input.images.some(value => !validImage(value))) throw Error('最多支持 10 张 PNG/JPEG/WebP 参考图');
}
export class Pool {
  constructor(directory, engine) { this.directory = directory; this.engine = engine; this.tail = Promise.resolve(); this.submitting = new Set(); this.operations = new Map(); }
  async locked(action) { const run = this.tail.then(action); this.tail = run.catch(() => {}); return run; }
  async load() {
    if (this.state) return;
    let state;
    try { state = JSON.parse(await readFile(path.join(this.directory, 'pool.json'), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw Error('账号池记录损坏，已停止操作'); }
    state ||= { version: 1, enabled: false, profiles: [], jobs: {} };
    if (state.version !== 1 || typeof state.enabled !== 'boolean' || !Array.isArray(state.profiles) || !state.jobs || typeof state.jobs !== 'object' || Array.isArray(state.jobs)) throw Error('账号池记录格式无效');
    if (state.profiles.some(p => !p || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(p.id)) || new Set(state.profiles.map(p => p.id)).size !== state.profiles.length) throw Error('账号环境身份无效');
    if (Object.entries(state.jobs).some(([taskId, job]) => !/^[\w-]{1,128}$/.test(taskId) || !job || typeof job !== 'object' || !state.profiles.some(profile => profile.id === job.profileId))) throw Error('账号池任务身份无效');
    const before = JSON.stringify(state);
    for (const profile of state.profiles) {
      profile.label = profileLabel(profile.id);
      if (profile.state === 'idle') profile.state = 'cold';
      const jobs = Object.entries(state.jobs).filter(([, job]) => job.profileId === profile.id);
      const running = jobs.find(([, job]) => !terminal(job));
      const pending = jobs.find(([, job]) => job.phase === 'success' && !job.deliveredAt);
      if (running) { profile.state = 'busy'; profile.taskId = running[0]; profile.usedTaskId = running[0]; }
      else if (pending) { profile.state = 'pending'; profile.usedTaskId = pending[0]; delete profile.taskId; profile.reason = pendingReason; }
      else if (state.jobs[profile.usedTaskId]?.phase === 'failed' && profile.state !== 'exhausted') releaseProfile(profile);
      else if (state.lifecycleVersion !== 2 && jobs.length && !jobs.some(([, job]) => job.phase === 'success') && profile.state !== 'exhausted') releaseProfile(profile);
    }
    state.lifecycleVersion = 2;
    this.state = state;
    if (JSON.stringify(state) !== before) try { await this.save(); } catch (error) { this.state = undefined; throw error; }
  }
  async save() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const temporary = path.join(this.directory, '.pool-' + randomUUID());
    await writeFile(temporary, JSON.stringify(this.state), { mode: 0o600 });
    await rename(temporary, path.join(this.directory, 'pool.json'));
  }
  replenish(target = TARGET) {
    let active = this.state.profiles.length;
    while (active < target) {
      const id = randomUUID();
      this.state.profiles.push({ id, state: 'cold', label: profileLabel(id), quota: 'unknown' });
      active++;
    }
  }
  async warm(target = RESERVE) {
    if (this.maintenance) return this.maintenance;
    const pending = this.prepareReserve(target);
    this.maintenance = pending;
    try { return await pending; } finally { if (this.maintenance === pending) this.maintenance = undefined; }
  }
  async prepareReserve(target) {
    const cleaning = await this.locked(async () => {
      await this.load();
      if (!this.state.enabled || this.clearing) return [];
      this.replenish();
      await this.refreshDeliveries();
      for (const profile of this.state.profiles) {
        if (profile.state === 'idle' && !this.operations.has(profile.id) && this.engine.healthy && !this.engine.healthy(profile.id)) profile.state = 'cold';
      }
      const available = this.state.profiles.filter(p => !this.operations.has(p.id) && !p.needsCleanup && ['idle', 'cold'].includes(p.state)).length;
      const candidates = this.state.profiles.filter(p => p.state === 'used' && !this.operations.has(p.id) && !this.protected(p) && !this.engine.manuallyOpened?.(p.id) && (!p.checkedAt || Date.now() - Date.parse(p.checkedAt) >= 60000 || !p.needsCleanup)).slice(0, Math.max(0, target - available));
      for (const profile of candidates) this.operations.set(profile.id, 'cleaning');
      return candidates;
    });
    await Promise.all(cleaning.map(profile => this.clean(profile)));
    const candidates = await this.locked(async () => {
      if (!this.state.enabled || this.clearing) return [];
      const reusable = this.state.profiles.filter(p => !p.usedTaskId && !p.needsCleanup && ['idle', 'cold', 'attention'].includes(p.state)).length;
      this.replenish(this.state.profiles.length + Math.max(0, target - reusable));
      const missing = Math.max(0, target - this.state.profiles.filter(p => p.state === 'idle').length);
      const selected = this.state.profiles.filter(p => !this.operations.has(p.id) && !p.usedTaskId && !p.needsCleanup && (p.state === 'cold' || p.state === 'attention' && (!p.checkedAt || Date.now() - Date.parse(p.checkedAt) >= 60000))).slice(0, missing);
      for (const profile of selected) this.operations.set(profile.id, 'warming');
      await this.save();
      return selected;
    });
    const results = await Promise.all(candidates.map(async profile => {
      let result, reason;
      try { result = await this.engine.probe(profile.id); reason = result.ready ? '' : '网页未就绪或需要人工处理'; }
      catch { reason = '浏览器环境初始化失败，请检查运行环境'; }
      if (!result?.ready && this.engine.stop && !this.engine.manuallyOpened?.(profile.id)) await this.engine.stop(profile.id).catch(() => {});
      await this.locked(async () => {
        profile.state = result?.ready ? 'idle' : 'attention';
        profile.visitor = Boolean(result?.visitor); profile.reason = reason; profile.checkedAt = new Date().toISOString();
        this.operations.delete(profile.id);
        await this.save();
      });
      return Boolean(result?.ready);
    }));
    return results.filter(Boolean).length;
  }
  async maintain() { return this.warm(); }
  async configure({ enabled }) {
    if (typeof enabled !== 'boolean') throw Error('启用设置无效');
    await this.locked(async () => {
      await this.load(); this.state.enabled = enabled;
      this.replenish();
      await this.save();
    });
    await this.warm(); return this.snapshot();
  }
  snapshot() {
    const count = state => this.state.profiles.filter(p => p.state === state).length;
    return { enabled: this.state.enabled, target: TARGET, reserve: RESERVE, total: this.state.profiles.length, active: this.state.profiles.filter(p => ['idle', 'cold', 'busy', 'attention'].includes(p.state)).length, used: count('used') + count('pending'), pending: count('pending'), succeeded: Object.values(this.state.jobs).filter(j => j.phase === 'success').length, failed: Object.values(this.state.jobs).filter(j => j.phase === 'failed').length, cleaned: this.state.profiles.filter(p => p.clearedAt).length, cold: count('cold'), attention: count('attention'), cleaning: [...this.operations.values()].includes('cleaning'), warming: [...this.operations.values()].includes('warming'), idle: count('idle'), busy: count('busy'), profiles: this.state.profiles.map(p => ({ ...p })), quotaResetConfirmed: false };
  }
  async status() {
    // Page initialization may take seconds; reporting loaded state never waits for it.
    if (this.state) return this.snapshot();
    return this.locked(async () => { await this.load(); return this.snapshot(); });
  }
  async submit(input) {
    try { validateRequest(input); } catch (error) { error.beforeGeneration = true; throw error; }
    const digest = createHash('sha256').update(JSON.stringify({ ...input, images: input.images.map(value => typeof value === 'string' ? value : { mime: value.mime, bytes: value.bytes, sha256: value.sha256 }) })).digest('hex');
    let reserved;
    try { reserved = await this.locked(async () => {
      await this.load(); const old = this.state.jobs[input.taskId];
      if (old) {
        if (old.digest !== digest) throw Object.assign(Error('同一任务的参数已改变，禁止重复提交'), { submissionUnknown: true });
        if (old.receipt) return { receipt: old.receipt };
        throw Object.assign(Error('原任务提交未确认，保留原环境；未重新生成'), { submissionUnknown: true });
      }
      if (!this.state.enabled) throw Error('请先启用豆包浏览器账号池');
      this.replenish();
      const available = profile => !this.operations.has(profile.id) && !profile.usedTaskId && !profile.needsCleanup && !this.engine.manuallyOpened?.(profile.id);
      for (const profile of this.state.profiles) if (profile.state === 'idle' && available(profile) && this.engine.healthy && !this.engine.healthy(profile.id)) profile.state = 'cold';
      let selected = this.state.profiles.find(profile => profile.state === 'idle' && available(profile)) || this.state.profiles.find(profile => profile.state === 'cold' && available(profile));
      let cleanup = false;
      if (!selected) {
        await this.refreshDeliveries();
        selected = this.state.profiles.find(profile => profile.state === 'used' && !this.operations.has(profile.id) && !this.protected(profile) && !this.engine.manuallyOpened?.(profile.id));
        cleanup = Boolean(selected);
      }
      selected ||= this.state.profiles.find(profile => profile.state === 'attention' && available(profile));
      if (!selected) { this.replenish(this.state.profiles.length + 1); selected = this.state.profiles.at(-1); }
      const prepare = cleanup || selected.state !== 'idle';
      const profileIndex = this.state.profiles.indexOf(selected);
      const [profile] = this.state.profiles.splice(profileIndex, 1);
      this.state.profiles.push(profile);
      profile.state = 'busy'; profile.taskId = input.taskId; profile.usedTaskId = input.taskId; delete profile.reason;
      this.state.jobs[input.taskId] = { profileId: profile.id, digest, phase: 'reserved', receipt: { taskId: input.taskId, profileId: profile.id } };
      await this.save();
      this.submitting.add(input.taskId);
      return { profileId: profile.id, prepare, cleanup };
    }); } catch (error) { if (!error.submissionUnknown) error.beforeGeneration = true; throw error; }
    if (reserved.receipt) return reserved.receipt;
    const persist = checkpoint => this.locked(async () => {
      const record = this.state.jobs[input.taskId];
      if (terminal(record)) return;
      record.checkpoint = checkpoint; record.phase = checkpoint.phase; await this.save();
    });
    try {
      if (reserved.prepare) {
        let cleanupPending = reserved.cleanup;
        try {
          if (reserved.cleanup) {
            await this.engine.clear(reserved.profileId);
            cleanupPending = false;
            await this.locked(async () => {
              const profile = this.state.profiles.find(value => value.id === reserved.profileId);
              profile.needsCleanup = false; profile.quota = 'unknown'; profile.clearedAt = new Date().toISOString(); delete profile.checkedAt;
              await this.save();
            });
          }
          const result = await this.engine.probe(reserved.profileId);
          if (!result.ready) throw Error('浏览器网页未就绪或需要人工处理，当前任务尚未提交视频生成');
        } catch (error) { error.beforeGeneration = true; error.environmentUnready = true; error.cleanupFailed = cleanupPending; throw error; }
      }
      const checkpoint = await this.engine.submit(reserved.profileId, input, persist);
      const receipt = { taskId: input.taskId, profileId: reserved.profileId };
      await this.locked(async () => {
        const record = this.state.jobs[input.taskId];
        if (terminal(record)) return;
        Object.assign(record, { checkpoint, receipt, phase: 'accepted' }); await this.save();
      });
      return receipt;
    } catch (error) {
      let stopping, settled = false;
      await this.locked(async () => {
        const record = this.state.jobs[input.taskId];
        if (terminal(record)) { settled = true; return; }
        if (error.beforeGeneration === true) {
          record.phase = 'failed';
          record.result = { status: 'failed', reason: error.message || '生成受理前失败' };
          record.quotaRejected = error.quotaRejected === true;
          stopping = this.finishProfile(input.taskId, record);
          if (error.environmentUnready) {
            const profile = this.state.profiles.find(value => value.id === reserved.profileId);
            profile.state = 'attention'; profile.reason = error.message; profile.checkedAt = new Date().toISOString();
            if (error.cleanupFailed) profile.needsCleanup = true;
          }
        } else record.phase = 'unknown';
        await this.save();
      });
      await this.stopFinished(stopping);
      if (error.beforeGeneration === true && !settled) throw error;
      const receipt = { taskId: input.taskId, profileId: reserved.profileId };
      await this.locked(async () => { this.state.jobs[input.taskId].receipt = receipt; await this.save(); });
      return receipt;
    } finally { this.submitting.delete(input.taskId); }
  }
  async query(receipt) {
    let stopping;
    const record = await this.locked(async () => {
      await this.load(); const value = this.state.jobs[receipt?.taskId];
      if (!value || value.profileId !== receipt.profileId || !value.receipt) throw Error('任务回执与账号环境不匹配');
      const preparing = ['reserved', 'preparing', 'create_intent', 'workspace_ready', 'register_intent', 'node_intent'].includes(value.checkpoint?.phase || value.phase);
      if (!value.result && preparing && !value.checkpoint?.requestId && !this.submitting.has(receipt.taskId)) {
        value.phase = 'failed';
        value.result = { status: 'failed', reason: '本地浏览器准备阶段已中断，尚未提交视频生成；可重新提交此镜头' };
        stopping = this.finishProfile(receipt.taskId, value);
        await this.save();
      }
      return structuredClone(value);
    });
    await this.stopFinished(stopping);
    if (record.result) return record.result;
    if (record.phase === 'failed') return { status: 'failed', reason: '生成受理前失败' };
    if (!record.checkpoint?.requestId && this.submitting.has(receipt.taskId)) return { status: 'preparing', reason: '浏览器正在准备画布和参考图，尚未提交视频生成' };
    if (!record.checkpoint?.itemId || !record.checkpoint?.workspaceId || !record.checkpoint?.requestId) return { status: 'submission_pending', reason: '原任务提交待确认，保留原环境继续核对；不会重复提交' };
    const result = await this.engine.query(receipt.profileId, record.checkpoint);
    if (['success', 'failed'].includes(result.status)) await this.locked(async () => {
      const job = this.state.jobs[receipt.taskId];
      if (job.result) return;
      job.phase = result.status; job.result = result;
      job.quotaRejected = result.quotaRejected === true;
      stopping = this.finishProfile(receipt.taskId, job);
      // Commit the terminal result and its released reservation together.
      await this.save();
    });
    await this.stopFinished(stopping);
    return result;
  }
  async lookup(taskId) {
    if (!/^[\w-]{1,128}$/.test(taskId || '')) throw Error('任务身份无效');
    return this.locked(async () => {
      await this.load(); const record = this.state.jobs[taskId];
      if (!record?.receipt) throw Error('未找到原任务浏览器回执；不会重新生成');
      return record.receipt;
    });
  }
  finishProfile(taskId, job) {
    const profile = this.state.profiles.find(p => p.id === job.profileId);
    if (!profile || profile.usedTaskId !== taskId) return;
    delete profile.taskId;
    if (job.phase === 'success') { profile.state = job.deliveredAt ? 'used' : 'pending'; profile.reason = job.deliveredAt ? usedReason : pendingReason; }
    else {
      releaseProfile(profile);
      profile.reason = '上次生成失败，环境可再次调用；未确认上游额度';
      if (job.quotaRejected) { profile.state = 'exhausted'; profile.reason = job.result?.reason || '上游明确返回额度不足'; }
    }
    if (this.engine.stop) { this.operations.set(profile.id, 'stopping'); return profile.id; }
  }
  async stopFinished(id) {
    if (!id) return;
    let failed = false;
    try { await this.engine.stop(id); } catch { failed = true; }
    await this.locked(async () => {
      const profile = this.state.profiles.find(value => value.id === id);
      if (failed) { profile.needsCleanup = true; if (profile.state === 'cold') profile.state = 'attention'; profile.reason = '任务已结束，但浏览器关闭失败；清理成功前不调度'; }
      this.operations.delete(id);
      await this.save();
    });
  }
  protected(profile) {
    return profile.state === 'busy' || Object.values(this.state.jobs).some(job => job.profileId === profile.id && (!terminal(job) || job.phase === 'success' && !job.deliveredAt));
  }
  async refreshDeliveries() {
    let changed = false;
    for (const [taskId, job] of Object.entries(this.state.jobs)) {
      if (job.phase !== 'success' || job.deliveredAt) continue;
      let marker;
      try { marker = JSON.parse(await readFile(path.join(this.directory, 'deliveries', taskId + '.json'), 'utf8')); }
      catch (error) { if (error.code === 'ENOENT') continue; throw Error('本地交付确认记录无法读取，保留原环境'); }
      if (marker.taskId !== taskId || marker.delivered !== true) continue;
      job.deliveredAt = new Date().toISOString();
      const profile = this.state.profiles.find(p => p.id === job.profileId);
      if (profile?.usedTaskId === taskId && !this.protected(profile)) { profile.state = 'used'; profile.reason = usedReason; }
      changed = true;
    }
    if (changed) await this.save();
  }
  async delivered(receipt) {
    return this.locked(async () => {
      await this.load();
      const job = this.state.jobs[receipt?.taskId];
      if (!job || job.profileId !== receipt.profileId || job.phase !== 'success') throw Error('交付确认与成功任务回执不匹配');
      job.deliveredAt ||= new Date().toISOString();
      const profile = this.state.profiles.find(p => p.id === job.profileId);
      if (profile?.usedTaskId === receipt.taskId && !this.protected(profile)) { profile.state = 'used'; profile.reason = usedReason; }
      await this.save(); return { confirmed: true };
    });
  }
  async clean(profile) {
    let cleaned = false;
    try { await this.engine.clear(profile.id); cleaned = true; } catch {}
    await this.locked(async () => {
      if (cleaned) {
        releaseProfile(profile); profile.needsCleanup = false; profile.quota = 'unknown'; profile.clearedAt = new Date().toISOString(); delete profile.checkedAt;
      } else {
        if (profile.state !== 'used') profile.state = 'attention';
        profile.needsCleanup = true; profile.reason = '网站数据未能完整清理，暂不调度'; profile.checkedAt = new Date().toISOString();
      }
      this.operations.delete(profile.id);
      await this.save();
    });
    return cleaned;
  }
  async clearAll() {
    if (this.clearTask) return this.clearTask;
    const pending = this.clearAvailable(); this.clearTask = pending;
    try { return await pending; } finally { if (this.clearTask === pending) this.clearTask = undefined; }
  }
  async clearAvailable() {
    const result = { cleared: 0, skipped: 0, failed: [], quotaResetConfirmed: false };
    const candidates = await this.locked(async () => {
      await this.load();
      await this.refreshDeliveries();
      this.clearing = true;
      const selected = [];
      for (const profile of this.state.profiles) {
        if (this.protected(profile) || this.operations.has(profile.id)) { result.skipped++; continue; }
        this.operations.set(profile.id, 'cleaning'); selected.push(profile);
      }
      return selected;
    });
    try {
      for (const profile of candidates) {
        if (await this.clean(profile)) result.cleared++; else result.failed.push(profile.id);
      }
    } finally { this.clearing = false; }
    await this.warm(); return result;
  }
  async open(id) {
    const profile = await this.locked(async () => {
      await this.load(); const profile = this.state.profiles.find(p => p.id === id);
      if (!profile || this.operations.has(id) || profile.state === 'busy') throw Error('环境不存在、正在处理或有任务占用');
      this.operations.set(id, 'opening'); return profile;
    });
    try {
      await this.engine.open(id);
      await this.locked(async () => {
        if (!profile.usedTaskId && profile.state !== 'exhausted' && !profile.needsCleanup) { profile.state = 'cold'; delete profile.reason; }
        await this.save();
      });
    } finally { this.operations.delete(id); }
    await this.warm(); return { opened: true };
  }
}
