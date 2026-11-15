import { randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';

export const TARGET = 100;
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
  if (!Array.isArray(input.images) || input.images.length > 10 || input.images.some(value => !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(value))) throw Error('最多支持 10 张 PNG/JPEG/WebP 参考图');
}
export class Pool {
  constructor(directory, engine) { this.directory = directory; this.engine = engine; this.tail = Promise.resolve(); }
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
  replenish() {
    let active = this.state.profiles.length;
    while (active < TARGET) {
      const id = randomUUID();
      this.state.profiles.push({ id, state: 'cold', label: profileLabel(id), quota: 'unknown' });
      active++;
    }
  }
  async warm(target = RESERVE, demand = false) {
    if (!this.state.enabled || this.clearing) return;
    for (const profile of this.state.profiles) {
      if (profile.state === 'idle' && this.engine.healthy && !this.engine.healthy(profile.id)) profile.state = 'cold';
    }
    this.replenish();
    await this.refreshDeliveries();
    const available = this.state.profiles.filter(p => !p.needsCleanup && ['idle', 'cold'].includes(p.state)).length;
    if (available < target) {
      const candidates = this.state.profiles.filter(p => p.state === 'used' && !this.protected(p) && !this.engine.manuallyOpened?.(p.id) && (!p.checkedAt || Date.now() - Date.parse(p.checkedAt) >= 60000 || !p.needsCleanup));
      for (const profile of candidates.slice(0, Math.max(RESERVE, target - available))) await this.clean(profile);
    }
    const missing = target - this.state.profiles.filter(p => p.state === 'idle').length;
    let prepared = 0;
    const eligible = this.state.profiles.filter(p => !p.usedTaskId && !p.needsCleanup && (p.state === 'cold' || p.state === 'attention' && (!p.checkedAt || Date.now() - Date.parse(p.checkedAt) >= 60000)));
    const candidates = demand ? eligible : eligible.slice(0, Math.min(RESERVE, Math.max(0, missing)));
    const deadline = Date.now() + 90000;
    for (const profile of candidates) {
      if (prepared >= missing || Date.now() >= deadline) break;
      this.warming = profile.id;
      try {
        const result = await this.engine.probe(profile.id);
        profile.state = result.ready ? 'idle' : 'attention';
        profile.visitor = Boolean(result.visitor);
        profile.reason = result.ready ? '' : '网页未就绪或需要人工处理';
        if (result.ready) prepared++;
      } catch { profile.state = 'attention'; profile.reason = '浏览器环境初始化失败，请检查运行环境'; }
      finally { this.warming = undefined; }
      // A visible login window belongs to the user until they close it.
      if (profile.state !== 'idle' && this.engine.stop && !this.engine.manuallyOpened?.(profile.id)) await this.engine.stop(profile.id).catch(() => {});
      profile.checkedAt = new Date().toISOString();
    }
    await this.save(); return prepared;
  }
  async maintain() { return this.locked(async () => { await this.load(); await this.warm(); }); }
  async configure({ enabled }) {
    if (typeof enabled !== 'boolean') throw Error('启用设置无效');
    return this.locked(async () => {
      await this.load(); this.state.enabled = enabled;
      this.replenish();
      await this.save(); await this.warm(); return this.snapshot();
    });
  }
  snapshot() {
    const count = state => this.state.profiles.filter(p => p.state === state).length;
    return { enabled: this.state.enabled, target: TARGET, reserve: RESERVE, total: this.state.profiles.length, active: this.state.profiles.filter(p => ['idle', 'cold', 'busy', 'attention'].includes(p.state)).length, used: count('used') + count('pending'), pending: count('pending'), succeeded: Object.values(this.state.jobs).filter(j => j.phase === 'success').length, failed: Object.values(this.state.jobs).filter(j => j.phase === 'failed').length, cleaned: this.state.profiles.filter(p => p.clearedAt).length, cold: count('cold'), attention: count('attention'), cleaning: Boolean(this.cleaning), warming: Boolean(this.warming), idle: count('idle'), busy: count('busy'), profiles: this.state.profiles.map(p => ({ ...p })), quotaResetConfirmed: false };
  }
  async status() {
    // Page initialization may take seconds; reporting loaded state never waits for it.
    if (this.state) return this.snapshot();
    return this.locked(async () => { await this.load(); return this.snapshot(); });
  }
  async submit(input) {
    try { validateRequest(input); } catch (error) { error.beforeGeneration = true; throw error; }
    const digest = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    let reserved;
    try { reserved = await this.locked(async () => {
      await this.load(); const old = this.state.jobs[input.taskId];
      if (old) {
        if (old.digest !== digest) throw Object.assign(Error('同一任务的参数已改变，禁止重复提交'), { submissionUnknown: true });
        if (old.receipt) return { receipt: old.receipt };
        throw Object.assign(Error('原任务提交未确认，保留原环境；未重新生成'), { submissionUnknown: true });
      }
      if (!this.state.enabled || this.clearing) throw Error('请先启用豆包浏览器账号池');
      if (this.state.profiles.filter(p => p.state === 'busy').length >= TARGET - RESERVE) throw Error('豆包浏览器空闲环境正在等待任务释放：已有 98 个任务占用，另保留 2 个；不是本机内存不足，当前任务尚未提交上游');
      // Prepare a third page before reservation so both idle pages stay available.
      await this.warm(RESERVE + 1, true);
      if (this.state.profiles.filter(p => p.state === 'idle').length < RESERVE + 1) {
        const status = this.snapshot();
        throw Error('豆包浏览器空闲环境不足：就绪 ' + status.idle + '，待预热 ' + status.cold + '，需检查 ' + status.attention + '，任务占用 ' + status.busy + '；不是本机内存不足，当前任务尚未提交上游，请在账号管理查看环境状态后重试');
      }
      const profileIndex = this.state.profiles.findIndex(p => p.state === 'idle');
      const [profile] = this.state.profiles.splice(profileIndex, 1);
      this.state.profiles.push(profile);
      profile.state = 'busy'; profile.taskId = input.taskId; profile.usedTaskId = input.taskId; delete profile.reason;
      this.state.jobs[input.taskId] = { profileId: profile.id, digest, phase: 'reserved', receipt: { taskId: input.taskId, profileId: profile.id } };
      await this.save();
      return { profileId: profile.id };
    }); } catch (error) { if (!error.submissionUnknown) error.beforeGeneration = true; throw error; }
    if (reserved.receipt) return reserved.receipt;
    const persist = checkpoint => this.locked(async () => { this.state.jobs[input.taskId].checkpoint = checkpoint; this.state.jobs[input.taskId].phase = checkpoint.phase; await this.save(); });
    try {
      const checkpoint = await this.engine.submit(reserved.profileId, input, persist);
      const receipt = { taskId: input.taskId, profileId: reserved.profileId };
      await this.locked(async () => { Object.assign(this.state.jobs[input.taskId], { checkpoint, receipt, phase: 'accepted' }); await this.save(); });
      return receipt;
    } catch (error) {
      await this.locked(async () => {
        const record = this.state.jobs[input.taskId];
        if (error.beforeGeneration === true) {
          record.phase = 'failed';
          record.result = { status: 'failed', reason: error.message || '生成受理前失败' };
          record.quotaRejected = error.quotaRejected === true;
          await this.finishProfile(input.taskId, record);
        } else record.phase = 'unknown';
        await this.save();
      });
      if (error.beforeGeneration === true) throw error;
      const receipt = { taskId: input.taskId, profileId: reserved.profileId };
      await this.locked(async () => { this.state.jobs[input.taskId].receipt = receipt; await this.save(); });
      return receipt;
    }
  }
  async query(receipt) {
    const record = await this.locked(async () => {
      await this.load(); const value = this.state.jobs[receipt?.taskId];
      if (!value || value.profileId !== receipt.profileId || !value.receipt) throw Error('任务回执与账号环境不匹配');
      return structuredClone(value);
    });
    if (record.result) return record.result;
    if (record.phase === 'failed') return { status: 'failed', reason: '生成受理前失败' };
    if (!record.checkpoint?.itemId || !record.checkpoint?.workspaceId || !record.checkpoint?.requestId) throw Error('原任务提交未确认，保留环境，需人工核对原会话；不会重新生成');
    const result = await this.engine.query(receipt.profileId, record.checkpoint);
    if (['success', 'failed'].includes(result.status)) await this.locked(async () => {
      const job = this.state.jobs[receipt.taskId];
      if (job.result) return;
      job.phase = result.status; job.result = result;
      job.quotaRejected = result.quotaRejected === true;
      await this.finishProfile(receipt.taskId, job);
      // Commit the terminal result and its released reservation together.
      await this.save(); await this.warm();
    });
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
  async finishProfile(taskId, job) {
    const profile = this.state.profiles.find(p => p.id === job.profileId);
    if (!profile || profile.usedTaskId !== taskId) return;
    delete profile.taskId;
    if (job.phase === 'success') { profile.state = job.deliveredAt ? 'used' : 'pending'; profile.reason = job.deliveredAt ? usedReason : pendingReason; }
    else {
      releaseProfile(profile);
      profile.reason = '上次生成失败，环境可再次调用；未确认上游额度';
      if (job.quotaRejected) { profile.state = 'exhausted'; profile.reason = job.result?.reason || '上游明确返回额度不足'; }
    }
    if (this.engine.stop) await this.engine.stop(profile.id).catch(() => { profile.needsCleanup = true; if (profile.state === 'cold') profile.state = 'attention'; profile.reason = '任务已结束，但浏览器关闭失败；清理成功前不调度'; });
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
    this.cleaning = true;
    try {
      await this.engine.clear(profile.id);
      releaseProfile(profile); profile.needsCleanup = false; profile.quota = 'unknown'; profile.clearedAt = new Date().toISOString(); delete profile.checkedAt;
      return true;
    } catch {
      if (profile.state !== 'used') profile.state = 'attention';
      profile.needsCleanup = true; profile.reason = '网站数据未能完整清理，暂不调度'; profile.checkedAt = new Date().toISOString();
      return false;
    } finally { this.cleaning = false; }
  }
  async clearAll() {
    return this.locked(async () => {
      await this.load();
      await this.refreshDeliveries();
      this.clearing = true; const result = { cleared: 0, skipped: 0, failed: [], quotaResetConfirmed: false };
      try {
        for (const profile of this.state.profiles) {
          if (this.protected(profile)) { result.skipped++; continue; }
          if (await this.clean(profile)) result.cleared++; else result.failed.push(profile.id);
        }
        await this.save();
      } finally { this.clearing = false; }
      await this.warm(); return result;
    });
  }
  async open(id) {
    return this.locked(async () => {
      await this.load(); const profile = this.state.profiles.find(p => p.id === id);
      if (!profile || this.clearing || profile.state === 'busy') throw Error('环境不存在、正在清理或有任务占用');
      await this.engine.open(id);
      if (!profile.usedTaskId && profile.state !== 'exhausted' && !profile.needsCleanup) { profile.state = 'cold'; delete profile.reason; }
      await this.save();
      await this.warm(); return { opened: true };
    });
  }
}
