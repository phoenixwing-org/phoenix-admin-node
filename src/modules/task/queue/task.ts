import { MainApp } from '@midwayjs/core';
import { BaseCoolQueue, CoolQueue } from '@cool-midway/task';
import { TaskBullService } from '../service/bull';
import { IMidwayApplication } from '@midwayjs/core';

/**
 * 任务
 */
@CoolQueue()
export abstract class TaskInfoQueue extends BaseCoolQueue {
  @MainApp()
  app: IMidwayApplication;

  async data(job, done: any): Promise<void> {
    const taskBullService = await this.app
      .getApplicationContext()
      .getAsync(TaskBullService);
    try {
      const result = await taskBullService.invokeService(job.data.service);
      taskBullService.record(job.data, 1, JSON.stringify(result));
    } catch (error) {
      taskBullService.record(job.data, 0, error.message);
    }
    if (!job.data.isOnce) {
      taskBullService.updateNextRunTime(job.data.jobId);
      taskBullService.updateStatus(job.data.id);
    }
    done();
  }
}
