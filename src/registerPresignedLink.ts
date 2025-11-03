#!/usr/bin/env node
import process from 'node:process';
import { createApiClient } from './apiClient.js';

const usage = () => {
  console.error('Usage: tsx src/registerPresignedLink.ts <job_id>');
  process.exit(1);
};

const [, , jobId] = process.argv;

if (!jobId) {
  usage();
}

const main = async () => {
  const apiClient = createApiClient();
  const link = await apiClient.getJobPresignedLink(jobId);

  if (!link) {
    console.error(`No presigned link available yet for job ${jobId}.`);
    process.exit(1);
  }

  console.log(`Job ID: ${link.jobId}`);
  console.log(`BTIH: ${link.btih}`);
  console.log(`Bucket: ${link.bucket}`);
  console.log(`Key: ${link.key}`);
  console.log(`Short URL: ${link.shortUrl ?? '—'}`);
  console.log(`S3 URL: ${link.s3Url}`);
  console.log(`Expires at: ${link.expiresAt}`);
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
