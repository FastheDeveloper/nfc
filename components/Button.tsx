import { forwardRef } from 'react';
import { Text, TouchableOpacity, TouchableOpacityProps, View } from 'react-native';

interface ButtonProps extends TouchableOpacityProps {
  title: string;
}

export const Button = forwardRef<View, ButtonProps>(
  ({ title, className, ...touchableProps }, ref) => {
    return (
      <TouchableOpacity
        ref={ref}
        {...touchableProps}
        className={`${styles.button} ${touchableProps.disabled ? styles.disabled : ''} ${className ?? ''}`}>
        <Text className={styles.buttonText}>{title}</Text>
      </TouchableOpacity>
    );
  }
);

Button.displayName = 'Button';

const styles = {
  button: 'items-center bg-indigo-600 rounded-2xl shadow-md px-5 py-4',
  disabled: 'opacity-40',
  buttonText: 'text-white text-base font-semibold text-center',
};
