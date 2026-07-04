import Screen from 'neo-blessed/lib/widgets/screen';
import Box from 'neo-blessed/lib/widgets/box';
import List from 'neo-blessed/lib/widgets/list';
import Prompt from 'neo-blessed/lib/widgets/prompt';
import Question from 'neo-blessed/lib/widgets/question';
import Message from 'neo-blessed/lib/widgets/message';

function make(Ctor: any, options?: Record<string, unknown>): any {
  return new Ctor(options);
}

export const blessed = {
  screen: (options?: Record<string, unknown>) => make(Screen, options),
  box: (options?: Record<string, unknown>) => make(Box, options),
  list: (options?: Record<string, unknown>) => make(List, options),
  prompt: (options?: Record<string, unknown>) => make(Prompt, options),
  question: (options?: Record<string, unknown>) => make(Question, options),
  message: (options?: Record<string, unknown>) => make(Message, options),
};
