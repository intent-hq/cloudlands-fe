// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import DeviceIconPicker from './DeviceIconPicker.svelte';

describe('DeviceIconPicker', () => {
  afterEach(cleanup);

  it('announces the selected value and updates it with keyboard selection', async () => {
    const onchange = vi.fn();
    render(DeviceIconPicker, {
      props: { record: { detectedDeviceKind: 'macStudio' }, onchange },
    });

    const trigger = screen.getByTestId('device-icon-picker-trigger');
    expect(trigger.getAttribute('aria-label')).toContain('Mac Studio');
    trigger.focus();
    await fireEvent.keyDown(trigger, { key: 'Enter' });

    const listbox = screen.getByRole('listbox');
    expect(within(listbox).getAllByRole('option')).toHaveLength(17);
    expect(within(listbox).getAllByRole('option')[0].textContent).toContain('Mac Studio');

    await fireEvent.keyDown(trigger, { key: 'End' });
    await fireEvent.keyDown(trigger, { key: 'Enter' });
    await waitFor(() => expect(onchange).toHaveBeenCalledWith('pottedPlant'));
    expect(trigger.getAttribute('aria-label')).toContain('Potted plant');
    expect(document.activeElement).toBe(trigger);
  });

  it('refreshes the automatic label when detection changes', async () => {
    const view = render(DeviceIconPicker, { props: { record: { detectedDeviceKind: 'laptop' } } });
    expect(screen.getByTestId('device-icon-picker-trigger').textContent).toContain('Laptop');

    await view.rerender({ record: { detectedDeviceKind: 'cloudVm' } });
    expect(screen.getByTestId('device-icon-picker-trigger').textContent).toContain('Cloud VM');
  });

  it('starts from the override carried by the record', () => {
    render(DeviceIconPicker, {
      props: { record: { deviceIcon: 'cat', detectedDeviceKind: 'laptop' } },
    });
    expect(screen.getByTestId('device-icon-picker-trigger').textContent).toContain('Cat');
  });

  it('accepts an explicitly undefined bindable value and uses the record override', () => {
    render(DeviceIconPicker, {
      props: { record: { deviceIcon: 'cat', detectedDeviceKind: 'laptop' }, value: undefined },
    });
    expect(screen.getByTestId('device-icon-picker-trigger').textContent).toContain('Cat');
  });
});
