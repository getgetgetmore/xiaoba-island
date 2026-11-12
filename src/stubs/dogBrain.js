// 占位狗脑：狗在草坪中心原地 idle。接口对应 DESIGN.md 3.8。
// 只有 brain 才能动 dog.group.position / rotation.y。
export function createBrain(ctx) {
  const { dog, island } = ctx;
  const a = island.anchors;
  if (dog) {
    dog.group.position.set(a.lawn.x, island.heightAt(a.lawn.x, a.lawn.z), a.lawn.z);
    dog.group.rotation.y = 0.6;
    dog.setAction('idle');
  }

  const brain = {
    mode: 'auto',
    state: 'auto:idle',
    update(dt, env) {
      if (!dog) return;
      dog.speed = 0;
      dog.setAction('idle');
    },
  };
  return brain;
}
