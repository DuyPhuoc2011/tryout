import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Tasks (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();
  });

  afterEach(async () => { await app.close(); });

  it('creates a task', async () => {
    const res = await request(app.getHttpServer())
      .post('/tasks').send({ title: 'Write tests' }).expect(201);
    expect(res.body).toMatchObject({ title: 'Write tests', completed: false });
    expect(res.body.id).toBeDefined();
  });

  it('lists created tasks', async () => {
    await request(app.getHttpServer()).post('/tasks').send({ title: 'A' });
    await request(app.getHttpServer()).post('/tasks').send({ title: 'B' });
    const res = await request(app.getHttpServer()).get('/tasks').expect(200);
    expect(res.body.length).toBe(2);
  });

  it('returns 404 for a missing task', async () => {
    await request(app.getHttpServer()).get('/tasks/does-not-exist').expect(404);
  });

  it('rejects a task with no title', async () => {
    await request(app.getHttpServer()).post('/tasks').send({}).expect(400);
  });
});
