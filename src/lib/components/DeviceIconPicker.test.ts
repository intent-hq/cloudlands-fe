// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import DeviceIcon from './DeviceIcon.svelte';
import DeviceIconPicker from './DeviceIconPicker.svelte';
import DeviceIconPickerHarness from './DeviceIconPicker.test-harness.svelte';

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
    expect(within(listbox).getByRole('group', { name: 'Devices' })).toBeTruthy();
    expect(within(listbox).getByRole('group', { name: 'Wild cards' })).toBeTruthy();
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

  it('supports an undefined bound value and updates its parent after mouse selection', async () => {
    render(DeviceIconPickerHarness);
    expect(screen.getByTestId('device-icon-picker-trigger').textContent).toContain('Cat');
    expect(screen.getByTestId('bound-device-icon-value').textContent).toBe('undefined');

    await fireEvent.keyDown(screen.getByTestId('device-icon-picker-trigger'), { key: 'Enter' });
    await fireEvent.pointerUp(screen.getByRole('option', { name: 'Rocket' }), {
      pointerType: 'mouse',
    });

    await waitFor(() =>
      expect(screen.getByTestId('bound-device-icon-value').textContent).toBe('rocket'),
    );
  });

  it('does not open when disabled', async () => {
    render(DeviceIconPicker, { props: { record: {}, disabled: true } });
    const trigger = screen.getByTestId('device-icon-picker-trigger') as HTMLButtonElement;

    expect(trigger.disabled).toBe(true);
    await fireEvent.pointerDown(trigger);
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});

describe('DeviceIcon', () => {
  afterEach(cleanup);

  it('updates the rendered icon with its record and supports decorative or labelled use', async () => {
    const view = render(DeviceIcon, { props: { record: { detectedDeviceKind: 'laptop' } } });
    const decorativeIcon = view.container.querySelector('svg');
    const laptopGeometry = decorativeIcon?.innerHTML;
    expect(decorativeIcon?.getAttribute('aria-hidden')).toBe('true');
    expect(screen.queryByRole('img')).toBeNull();

    await view.rerender({ record: { detectedDeviceKind: 'macStudio' }, label: 'Workstation' });
    const labelledIcon = screen.getByRole('img', { name: 'Workstation' });
    expect(labelledIcon.innerHTML).not.toBe(laptopGeometry);
    expect(labelledIcon.getAttribute('aria-hidden')).toBeNull();
  });

  it.each([
    ['macMini', 'Mac mini'],
    ['macStudio', 'Mac Studio'],
  ] as const)('forwards size and class to the %s icon', (kind, label) => {
    render(DeviceIcon, {
      props: { record: { deviceIcon: kind }, size: 24, class: 'forwarded-icon', label },
    });
    const icon = screen.getByRole('img', { name: label });

    expect(icon.getAttribute('width')).toBe('24');
    expect(icon.getAttribute('height')).toBe('24');
    expect(icon.classList.contains('forwarded-icon')).toBe(true);
  });
});
